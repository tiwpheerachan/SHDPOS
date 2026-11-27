package th.co.shd.posshell

import android.annotation.SuppressLint
import android.app.Presentation
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.view.Display
import android.view.WindowManager
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * จอลูกค้า (จอที่สองของ D2s) — เปิดหน้า /pos/display ของระบบเรา
 *   จอหลักส่งข้อมูลตะกร้า/ยอด/QR มาทาง push() → เรียก window.__shdDisplay(payload) ในหน้าจอลูกค้า
 */
class CustomerDisplay(ctx: Context, display: Display, private val url: String) : Presentation(ctx, display) {
    private var web: WebView? = null
    @Volatile private var ready = false
    private var last: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val w = WebView(context)
        w.setBackgroundColor(Color.WHITE)
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false // วิดีโอแบนเนอร์เล่นเองตอนจอว่าง
            userAgentString = "$userAgentString SHDShell/${BuildConfig.VERSION_NAME}"
        }
        w.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, u: String?) {
                ready = true
                last?.let { send(it) } // ส่งสถานะล่าสุดซ้ำหลังโหลดเสร็จ
            }
        }
        setContentView(w)
        web = w
        w.loadUrl(url)
    }

    /** เรียกจาก main thread เท่านั้น */
    fun push(json: String) {
        last = json
        if (ready) send(json)
    }

    private fun send(json: String) {
        web?.evaluateJavascript("window.__shdDisplay&&window.__shdDisplay(JSON.parse(${JSONObject.quote(json)}))", null)
    }

    fun reload() { ready = false; web?.loadUrl(url) }

    override fun onStop() {
        web?.destroy()
        web = null
        super.onStop()
    }
}
