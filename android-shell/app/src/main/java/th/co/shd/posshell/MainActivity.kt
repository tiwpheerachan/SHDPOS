package th.co.shd.posshell

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * แอปตัวหุ้ม SHD POS สำหรับเครื่อง Sunmi
 *   - เปิดเว็บระบบเต็มจอ (หน้าจอ/ฟีเจอร์ทั้งหมดอยู่บนเว็บ แก้เว็บแล้วเครื่องอัปเดตตาม)
 *   - window.SHDShell: พิมพ์ใบเสร็จด้วยเครื่องพิมพ์ในตัว + ส่งข้อมูลจอลูกค้าไปจอที่สอง
 *   - ตั้ง URL ระบบ: แตะมุมซ้ายบน 5 ครั้งติดกัน
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var printer: SunmiPrinter
    private val main = Handler(Looper.getMainLooper())
    private var display: CustomerDisplay? = null
    @Volatile private var pageHost: String? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val printQueue = java.util.concurrent.Executors.newSingleThreadExecutor() // พิมพ์ทีละใบตามลำดับ

    private val prefs by lazy { getSharedPreferences("shell", Context.MODE_PRIVATE) }
    private val baseUrl: String get() = (prefs.getString("url", null) ?: BuildConfig.DEFAULT_URL).trimEnd('/')
    private val baseHost: String? get() = Uri.parse(baseUrl).host

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val uris = WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data)
        fileCallback?.onReceiveValue(uris)
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        printer = SunmiPrinter(applicationContext).also { it.bind() }

        web = WebView(this)
        setContentView(web)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true        // localStorage
            databaseEnabled = true          // IndexedDB (บิลออฟไลน์)
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            userAgentString = "$userAgentString SHDShell/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true) // ล็อกอิน SSO กลาง

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val host = req.url.host ?: return false
                if (allowedHost(host)) return false
                // ลิงก์ภายนอก (เช่น Google Maps) เปิดด้วยแอปอื่น
                try { startActivity(Intent(Intent.ACTION_VIEW, req.url)) } catch (_: Exception) {}
                return true
            }
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                pageHost = url?.let { Uri.parse(it).host }
            }
            override fun onReceivedError(view: WebView?, req: WebResourceRequest?, err: WebResourceError?) {
                if (req?.isForMainFrame == true) showSetup(getString(R.string.app_name) + " — " + (err?.description ?: "load error"))
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView?, cb: ValueCallback<Array<Uri>>?, p: FileChooserParams?): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try { pickFile.launch(p!!.createIntent()); true } catch (_: Exception) { fileCallback = null; false }
            }
        }
        web.addJavascriptInterface(Bridge(), "SHDShell")

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl("$baseUrl/pos")

        attachDisplay()
        (getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).registerDisplayListener(displayListener, main)
        hideSystemBars()
    }

    /** หน้าเว็บของระบบเรา + SSO กลาง เท่านั้นที่ใช้ในแอปได้ */
    private fun allowedHost(host: String): Boolean =
        host == baseHost || host.endsWith(".shd-technology.co.th") || host == "shd-technology.co.th"

    // ---------------- จอลูกค้า ----------------
    private fun findCustomerDisplay(): Display? {
        val dm = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        return dm.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION).firstOrNull()
            ?: dm.displays.firstOrNull { it.displayId != Display.DEFAULT_DISPLAY }
    }

    private fun attachDisplay() {
        if (display != null) return
        val d = findCustomerDisplay() ?: return
        try {
            display = CustomerDisplay(this, d, "$baseUrl/pos/display?shell=1").also { it.show() }
        } catch (_: Exception) { display = null }
    }

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(id: Int) { attachDisplay() }
        override fun onDisplayRemoved(id: Int) { if (display?.display?.displayId == id) { display?.dismiss(); display = null } }
        override fun onDisplayChanged(id: Int) {}
    }

    // ---------------- สะพานให้หน้าเว็บเรียก ----------------
    inner class Bridge {
        /** ตอบเฉพาะหน้าเว็บของระบบเรา (กันหน้าอื่นสั่งพิมพ์) */
        private fun trusted(): Boolean = pageHost != null && pageHost == baseHost

        @JavascriptInterface
        fun info(): String = JSONObject()
            .put("shell", "sunmi")
            .put("version", BuildConfig.VERSION_NAME)
            .put("printer", printer.connected)
            .put("paperWidthPx", printer.paperWidthPx())
            .put("secondScreen", display != null || findCustomerDisplay() != null)
            .put("model", Build.MODEL ?: "")
            .toString()

        @JavascriptInterface
        fun printImage(base64Png: String): String {
            if (!trusted()) return result(false, "untrusted_page")
            val r = printer.printImage(base64Png)
            return result(r.ok, r.error)
        }

        /** ไม่บล็อกหน้าเว็บ — พิมพ์ในเธรดแยก แล้วแจ้งผลกลับด้วย window.__shdPrintDone(id, json) */
        @JavascriptInterface
        fun printImageAsync(base64Png: String, id: String) {
            if (!trusted()) { done(id, result(false, "untrusted_page")); return }
            printQueue.execute {
                val r = printer.printImage(base64Png)
                done(id, result(r.ok, r.error))
            }
        }

        private fun done(id: String, json: String) {
            main.post { web.evaluateJavascript("window.__shdPrintDone&&window.__shdPrintDone(${JSONObject.quote(id)},${JSONObject.quote(json)})", null) }
        }

        @JavascriptInterface
        fun printRaw(base64: String): String {
            if (!trusted()) return result(false, "untrusted_page")
            val r = printer.printRaw(base64)
            return result(r.ok, r.error)
        }

        @JavascriptInterface
        fun display(json: String) {
            if (!trusted()) return
            main.post { attachDisplay(); display?.push(json) }
        }

        private fun result(ok: Boolean, error: String?): String =
            JSONObject().put("ok", ok).apply { if (error != null) put("error", error) }.toString()
    }

    // ---------------- ตั้งค่า (แตะมุมซ้ายบน 5 ครั้ง) ----------------
    private val taps = ArrayDeque<Long>()
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.action == MotionEvent.ACTION_DOWN && ev.x < 90 && ev.y < 90) {
            val now = SystemClock.uptimeMillis()
            taps.addLast(now)
            while (taps.isNotEmpty() && now - taps.first() > 2500) taps.removeFirst()
            if (taps.size >= 5) { taps.clear(); showSetup(null) }
        }
        return super.dispatchTouchEvent(ev)
    }

    private fun showSetup(error: String?) {
        if (isFinishing) return
        val pad = (16 * resources.displayMetrics.density).toInt()
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad / 2, pad, 0) }
        val input = EditText(this).apply { setText(baseUrl); setSingleLine() }
        val webVer = if (Build.VERSION.SDK_INT >= 26) WebView.getCurrentWebViewPackage()?.versionName ?: "?" else "?"
        val status = TextView(this).apply {
            text = buildString {
                if (error != null) append("⚠ $error\n\n")
                append("URL ระบบ / System URL\n")
            }
        }
        val meta = TextView(this).apply {
            text = "\nเครื่องพิมพ์ / Printer: ${if (printer.connected) "OK (${printer.paperWidthPx()} px)" else "—"}\n" +
                "จอลูกค้า / Customer display: ${if (findCustomerDisplay() != null) "OK" else "—"}\n" +
                "WebView: $webVer · Android ${Build.VERSION.RELEASE} · ${Build.MODEL}\n" +
                "App ${BuildConfig.VERSION_NAME}"
        }
        box.addView(status); box.addView(input); box.addView(meta)
        AlertDialog.Builder(this)
            .setTitle("SHD POS — ตั้งค่า / Settings")
            .setView(box)
            .setPositiveButton("บันทึก + โหลดใหม่ / Save") { _, _ ->
                val u = input.text.toString().trim().trimEnd('/')
                if (u.startsWith("http")) prefs.edit().putString("url", u).apply()
                display?.dismiss(); display = null
                web.loadUrl("$baseUrl/pos")
                attachDisplay()
            }
            .setNeutralButton("โหลดใหม่ / Reload") { _, _ -> web.reload(); display?.reload() }
            .setNegativeButton("ปิด / Close", null)
            .show()
    }

    // ---------------- อื่น ๆ ----------------
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        (getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).unregisterDisplayListener(displayListener)
        display?.dismiss(); display = null
        printQueue.shutdown()
        printer.unbind()
        web.destroy()
        super.onDestroy()
    }
}
