// android/app/src/main/java/com/ffarena/screenrecorder/ScreenRecorderModule.kt
package com.ffarena.screenrecorder

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.graphics.*
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.*
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

class ScreenRecorderModule(reactContext: ReactApplicationContext)
    : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "ScreenRecorder"
        const val REQUEST_CODE = 1001
        const val FF_PACKAGE = "com.dts.freefireth"  // Free Fire package name
        // Free Fire MAX uses: "com.dts.freefiremax"
    }

    private val projectionManager by lazy {
        reactContext.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var mediaRecorder: MediaRecorder? = null
    private var outputPath: String = ""
    private var pendingPromise: Promise? = null
    private var isRecording = false

    // Watermark config
    private var watermarkEnabled = true
    private var playerName = "PlayerOne_99"

    private val handlerThread = HandlerThread("RecordThread").also { it.start() }
    private val handler = Handler(handlerThread.looper)

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName() = NAME

    // ─── JS-exposed methods ────────────────────────────────────────

    @ReactMethod
    fun isFreefireRunning(promise: Promise) {
        val am = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        // Desde Android 5+ getRunningAppProcesses solo devuelve tu propio proceso
        // Necesitas: adb shell / UsageStatsManager con permiso PACKAGE_USAGE_STATS
        val running = am.runningAppProcesses?.any {
            it.processName == FF_PACKAGE || it.processName == "com.dts.freefiremax"
        } ?: false
        promise.resolve(running)
    }

    @ReactMethod
    fun checkUsageStatsPermission(promise: Promise) {
        // Alternativa más confiable: UsageStatsManager
        val usm = reactContext.getSystemService(Context.USAGE_STATS_SERVICE) as android.app.usage.UsageStatsManager
        val now = System.currentTimeMillis()
        val stats = usm.queryUsageStats(
            android.app.usage.UsageStatsManager.INTERVAL_DAILY, now - 5000, now
        )
        val hasPermission = stats != null && stats.isNotEmpty()
        promise.resolve(hasPermission)
    }

    @ReactMethod
    fun requestPermission(promise: Promise) {
        pendingPromise = promise
        val intent = projectionManager.createScreenCaptureIntent()
        currentActivity?.startActivityForResult(intent, REQUEST_CODE)
            ?: promise.reject("NO_ACTIVITY", "No hay actividad activa")
    }

    @ReactMethod
    fun startRecording(options: ReadableMap, promise: Promise) {
        if (mediaProjection == null) {
            promise.reject("NO_PERMISSION", "Primero llama requestPermission()")
            return
        }
        if (isRecording) {
            promise.reject("ALREADY_RECORDING", "Ya hay una grabación activa")
            return
        }

        watermarkEnabled = options.hasKey("watermark") && options.getBoolean("watermark")
        playerName = if (options.hasKey("playerName")) options.getString("playerName")!! else "Player"

        val quality = if (options.hasKey("quality")) options.getString("quality") else "720p"
        val (width, height, bitrate) = when (quality) {
            "480p"  -> Triple(854,  480,  1_500_000)
            "1080p" -> Triple(1920, 1080, 6_000_000)
            else    -> Triple(1280, 720,  3_000_000)  // 720p default
        }

        val outputDir = reactContext.getExternalFilesDir("recordings")
        outputDir?.mkdirs()
        outputPath = "${outputDir?.absolutePath}/match_${System.currentTimeMillis()}.mp4"

        try {
            setupMediaRecorder(width, height, bitrate)

            if (watermarkEnabled) {
                // Con marca de agua: ruta por ImageReader + Canvas + MediaCodec
                startWithWatermark(width, height, bitrate)
            } else {
                // Sin marca de agua: ruta directa MediaRecorder (más eficiente)
                startDirect(width, height)
            }

            isRecording = true
            promise.resolve(outputPath)
            emitEvent("onRecordingStarted", null)
        } catch (e: Exception) {
            promise.reject("START_FAILED", e.message)
        }
    }

    private fun setupMediaRecorder(width: Int, height: Int, bitrate: Int) {
        mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(reactContext)
        } else {
            @Suppress("DEPRECATION") MediaRecorder()
        }
        mediaRecorder!!.apply {
            setVideoSource(MediaRecorder.VideoSource.SURFACE)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setOutputFile(outputPath)
            setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            setVideoEncodingBitRate(bitrate)
            setVideoFrameRate(30)
            setVideoSize(width, height)
            prepare()
        }
    }

    // ── Grabación directa (sin WM) — usa Surface del MediaRecorder ──
    private fun startDirect(width: Int, height: Int) {
        val surface = mediaRecorder!!.surface
        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "FFArena_Direct",
            width, height,
            reactContext.resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            surface, null, handler
        )
        mediaRecorder!!.start()
    }

    // ── Grabación con marca de agua ──
    // Pipeline: VirtualDisplay → ImageReader → Canvas + WM → MediaCodec → MP4
    private fun startWithWatermark(width: Int, height: Int, bitrate: Int) {
        // 1. ImageReader recibe frames de la pantalla
        val imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)

        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "FFArena_WM",
            width, height,
            reactContext.resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.surface, null, handler
        )

        // 2. MediaCodec como encoder de video
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, 30)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        }

        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val encoderSurface = codec.createInputSurface()
        codec.start()

        // 3. Canvas sobre la surface del encoder
        val wm = buildWatermarkPaint()

        imageReader.setOnImageAvailableListener({ reader ->
            val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                val planes = image.planes
                val buffer = planes[0].buffer
                val pixelStride = planes[0].pixelStride
                val rowStride = planes[0].rowStride
                val rowPadding = rowStride - pixelStride * width

                val bitmap = Bitmap.createBitmap(
                    width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888
                )
                bitmap.copyPixelsFromBuffer(buffer)
                val cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height)

                // Dibujar en la surface del encoder
                val canvas: Canvas? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    encoderSurface.lockHardwareCanvas()
                } else {
                    encoderSurface.lockCanvas(null)
                }
                canvas?.let {
                    it.drawBitmap(cropped, 0f, 0f, null)
                    drawWatermark(it, width, height, wm)
                    encoderSurface.unlockCanvasAndPost(it)
                }

                cropped.recycle()
                bitmap.recycle()
            } finally {
                image.close()
            }
        }, handler)

        mediaRecorder!!.start()
    }

    private fun buildWatermarkPaint() = Paint().apply {
        color = Color.WHITE
        alpha = 180
        textSize = 28f
        isAntiAlias = true
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    }

    private fun drawWatermark(canvas: Canvas, w: Int, h: Int, paint: Paint) {
        // Franja inferior semitransparente
        val bgPaint = Paint().apply { color = Color.argb(120, 0, 0, 0) }
        canvas.drawRect(0f, h - 50f, w.toFloat(), h.toFloat(), bgPaint)

        // Logo en dorado
        val goldPaint = paint.apply { color = Color.rgb(240, 180, 41) }
        canvas.drawText("⚡ FFARENA", 16f, h - 28f, goldPaint)

        // Usuario + timestamp en blanco
        val whitePaint = Paint(paint).apply {
            color = Color.WHITE; alpha = 180; textSize = 22f
        }
        val ts = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
            .format(java.util.Date())
        canvas.drawText("$playerName · $ts", 16f, h - 8f, whitePaint)

        // Anti-tamper texto derecha
        val dimPaint = Paint(paint).apply { color = Color.WHITE; alpha = 100; textSize = 18f }
        val antiTamper = "VERIFIED GAMEPLAY"
        val tw = dimPaint.measureText(antiTamper)
        canvas.drawText(antiTamper, w - tw - 16f, h - 16f, dimPaint)
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        if (!isRecording) {
            promise.reject("NOT_RECORDING", "No hay grabación activa")
            return
        }
        try {
            mediaRecorder?.stop()
            mediaRecorder?.reset()
            mediaRecorder?.release()
            mediaRecorder = null
            virtualDisplay?.release()
            virtualDisplay = null
            isRecording = false

            val args = Arguments.createMap().apply {
                putString("path", outputPath)
                putDouble("size", File(outputPath).length().toDouble())
            }
            emitEvent("onRecordingStopped", args)
            promise.resolve(outputPath)
        } catch (e: Exception) {
            promise.reject("STOP_FAILED", e.message)
        }
    }

    @ReactMethod
    fun releaseProjection() {
        mediaProjection?.stop()
        mediaProjection = null
    }

    // ─── ActivityEventListener ─────────────────────────────────────
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return
        if (resultCode == Activity.RESULT_OK && data != null) {
            mediaProjection = projectionManager.getMediaProjection(resultCode, data)
            mediaProjection?.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    isRecording = false
                    emitEvent("onProjectionStopped", null)
                }
            }, handler)
            pendingPromise?.resolve(true)
        } else {
            pendingPromise?.reject("PERMISSION_DENIED", "El usuario rechazó el permiso")
        }
        pendingPromise = null
    }

    override fun onNewIntent(intent: Intent?) {}

    private fun emitEvent(name: String, params: WritableMap?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(name, params)
    }

    @ReactMethod
    fun addListener(eventName: String) {}
    @ReactMethod
    fun removeListeners(count: Int) {}
}
