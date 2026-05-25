// android/app/src/main/java/com/ffarena/screenrecorder/ScreenRecorderPackage.kt
package com.ffarena.screenrecorder

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ScreenRecorderPackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =
        listOf(ScreenRecorderModule(ctx))

    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}

// ─── Registrar en MainApplication.kt ───────────────────────────────
// En tu MainApplication.kt, añade dentro de getPackages():
//
//   override fun getPackages(): List<ReactPackage> = listOf(
//       MainReactPackage(),
//       ScreenRecorderPackage(),   // <── añadir esto
//   )
