plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// URL ระบบเริ่มต้น (แก้ได้ในแอป: แตะมุมซ้ายบน 5 ครั้ง) · build ด้วย -PappUrl=https://... เพื่อเปลี่ยนค่าเริ่มต้น
val appUrl: String = (project.findProperty("appUrl") as String?) ?: "https://shdpos.onrender.com"

android {
    namespace = "th.co.shd.posshell"
    compileSdk = 34

    defaultConfig {
        applicationId = "th.co.shd.posshell"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "DEFAULT_URL", "\"$appUrl\"")
    }

    // เซ็นด้วยคีย์ถาวรเมื่อมี (GitHub Secrets) — คีย์เดิมทุกครั้ง = อัปเดตทับได้โดยไม่ต้องลบแอป (ข้อมูลออฟไลน์ไม่หาย)
    val ks = System.getenv("SHELL_KEYSTORE_PATH")
    signingConfigs {
        if (ks != null && file(ks).exists()) {
            create("release") {
                storeFile = file(ks)
                storePassword = System.getenv("SHELL_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SHELL_KEY_ALIAS")
                keyPassword = System.getenv("SHELL_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // SDK เครื่องพิมพ์ในตัวของ Sunmi (เชื่อม AIDL woyou.aidlservice.jiuiv5)
    implementation("com.sunmi:printerlibrary:1.0.18")
}
