package th.co.shd.posshell

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.InnerResultCallback
import com.sunmi.peripheral.printer.SunmiPrinterService
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * เครื่องพิมพ์ในตัวของ Sunmi (D2s ฯลฯ) ผ่าน SDK ของ Sunmi
 *   หน้าเว็บวาดใบเสร็จเป็นรูป (ภาษาไทยออกถูกแน่นอน) แล้วส่ง PNG base64 มา → พิมพ์ → ตัดกระดาษ (ถ้ามีมีดตัด)
 *   ไม่มีลิ้นชักเงินสด (ร้านไม่ใช้)
 */
class SunmiPrinter(private val ctx: Context) {
    @Volatile private var service: SunmiPrinterService? = null

    fun bind() {
        try {
            InnerPrinterManager.getInstance().bindService(ctx, object : InnerPrinterCallback() {
                override fun onConnected(s: SunmiPrinterService) { service = s }
                override fun onDisconnected() { service = null }
            })
        } catch (e: Exception) {
            Log.w(TAG, "bind printer failed", e)
        }
    }

    fun unbind() {
        try {
            InnerPrinterManager.getInstance().unBindService(ctx, object : InnerPrinterCallback() {
                override fun onConnected(s: SunmiPrinterService) {}
                override fun onDisconnected() {}
            })
        } catch (_: Exception) {}
        service = null
    }

    val connected: Boolean get() = service != null

    /** ความกว้างกระดาษเป็นจุด: 80 มม. = 576, 58 มม. = 384 (อ่านไม่ได้ = 576 เพราะ D2s เป็น 80 มม.) */
    fun paperWidthPx(): Int = try {
        if (service?.printerPaper == 1) 384 else 576
    } catch (_: Throwable) { 576 }

    /** สถานะเครื่องพิมพ์ → รหัสข้อผิดพลาด (null = พร้อม) — หน้าเว็บแปลเป็นข้อความ 3 ภาษา */
    private fun stateError(): String? = try {
        when (service?.updatePrinterState()) {
            null -> "printer_not_connected"
            1 -> null
            2 -> "printer_preparing"
            3 -> "printer_comm_error"
            4 -> "paper_out"
            5 -> "printer_overheat"
            6 -> "cover_open"
            7 -> "cutter_error"
            505 -> "printer_not_found"
            else -> null
        }
    } catch (_: Throwable) { null }

    fun printImage(base64Png: String): Result {
        val s = service ?: return Result(false, "printer_not_connected")
        stateError()?.let { return Result(false, it) }
        val bytes = try { Base64.decode(base64Png, Base64.DEFAULT) } catch (_: Exception) { return Result(false, "bad_image") }
        var bmp: Bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return Result(false, "bad_image")
        val max = paperWidthPx()
        if (bmp.width > max) bmp = Bitmap.createScaledBitmap(bmp, max, (bmp.height * max.toFloat() / bmp.width).toInt(), true)
        return runJob { cb ->
            s.enterPrinterBuffer(true)
            s.printBitmap(bmp, null)
            s.lineWrap(3, null)
            try { s.cutPaper(null) } catch (_: Throwable) { /* รุ่นที่ไม่มีมีดตัด */ }
            s.exitPrinterBufferWithCallback(true, cb)
        }
    }

    fun printRaw(base64: String): Result {
        val s = service ?: return Result(false, "printer_not_connected")
        stateError()?.let { return Result(false, it) }
        val bytes = try { Base64.decode(base64, Base64.DEFAULT) } catch (_: Exception) { return Result(false, "bad_data") }
        return runJob { cb ->
            s.enterPrinterBuffer(true)
            s.sendRAWData(bytes, null)
            s.exitPrinterBufferWithCallback(true, cb)
        }
    }

    /** ส่งงานแบบ buffer แล้วรอผลจริงจากเครื่องพิมพ์ (กระดาษหมด/ฝาเปิด ฯลฯ) ไม่เกิน 15 วินาที */
    private fun runJob(block: (InnerResultCallback) -> Unit): Result {
        val latch = CountDownLatch(1)
        var res = Result(false, "print_timeout")
        val cb = object : InnerResultCallback() {
            override fun onRunResult(isSuccess: Boolean) {}
            override fun onReturnString(result: String?) {}
            override fun onRaiseException(code: Int, msg: String?) { res = Result(false, "printer_error:$code ${msg ?: ""}".trim()); latch.countDown() }
            override fun onPrintResult(code: Int, msg: String?) { res = if (code == 0) Result(true, null) else Result(false, "printer_error:$code ${msg ?: ""}".trim()); latch.countDown() }
        }
        return try {
            block(cb)
            latch.await(15, TimeUnit.SECONDS)
            res
        } catch (e: Exception) {
            Result(false, "printer_error:${e.message ?: e.javaClass.simpleName}")
        }
    }

    data class Result(val ok: Boolean, val error: String?)

    companion object { private const val TAG = "SunmiPrinter" }
}
