import com.vanniktech.maven.publish.SonatypeHost

plugins {
    `java-library`
    checkstyle
    id("com.diffplug.spotless") version "6.25.0"
    id("com.vanniktech.maven.publish") version "0.30.0"
}

group = "org.byteveda"
version = "0.16.4"

java {
    // Sources + javadoc jars are added by the maven-publish plugin below.
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(11))
    }
}

repositories {
    mavenCentral()
}

// --- Publishing: Maven Central via the Central Publisher Portal ------------

mavenPublishing {
    publishToMavenCentral(SonatypeHost.CENTRAL_PORTAL)
    signAllPublications()
    coordinates(group.toString(), "taskito", version.toString())
    pom {
        name.set("Taskito")
        description.set("Rust-powered task queue for the JVM, via a JNI binding over the Taskito core.")
        url.set("https://github.com/ByteVeda/taskito")
        licenses {
            license {
                name.set("MIT")
                url.set("https://opensource.org/licenses/MIT")
            }
        }
        developers {
            developer {
                id.set("byteveda")
                name.set("ByteVeda")
            }
        }
        scm {
            url.set("https://github.com/ByteVeda/taskito")
            connection.set("scm:git:https://github.com/ByteVeda/taskito.git")
            developerConnection.set("scm:git:ssh://git@github.com/ByteVeda/taskito.git")
        }
    }
}

// --- Code integrity: formatting + static analysis -------------------------

spotless {
    java {
        target("src/**/*.java")
        palantirJavaFormat("2.50.0") // modern 4-space formatter; `spotlessApply` to fix
        removeUnusedImports()
        trimTrailingWhitespace()
        endWithNewline()
    }
}

checkstyle {
    toolVersion = "10.21.4"
    configFile = file("config/checkstyle/checkstyle.xml")
    isIgnoreFailures = false
}
// Native staging copies binaries under build/resources; never lint those.
tasks.withType<Checkstyle>().configureEach {
    source = fileTree("src") { include("**/*.java") }
}

dependencies {
    api("com.fasterxml.jackson.core:jackson-databind:2.17.2")
    implementation("info.picocli:picocli:4.7.6")

    testImplementation(platform("org.junit:junit-bom:5.10.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// --- Native (Rust cdylib) -------------------------------------------------

val crateDir = layout.projectDirectory.dir("../../crates/taskito-java")
val cargoTargetDir = layout.projectDirectory.dir("../../target")
val nativeStaging = layout.buildDirectory.dir("native")

// Build the native library for the local platform.
val cargoBuild by tasks.registering(Exec::class) {
    workingDir = crateDir.asFile
    commandLine("cargo", "build", "--release", "--features", "postgres,redis")
}

// Stage the built library under its platform-classifier resource path.
val copyNative by tasks.registering(Copy::class) {
    dependsOn(cargoBuild)
    from(cargoTargetDir.dir("release")) {
        include("libtaskito_java.so", "libtaskito_java.dylib", "taskito_java.dll")
    }
    into(nativeStaging.map { it.dir("org/byteveda/taskito/native/${platformClassifier()}") })
}

sourceSets["main"].resources.srcDir(nativeStaging)
tasks.named("processResources") { dependsOn(copyNative) }

tasks.test {
    useJUnitPlatform()
}

/** Resource classifier for the local platform, e.g. "linux-x86_64". */
fun platformClassifier(): String {
    val os = System.getProperty("os.name").lowercase()
    val arch = System.getProperty("os.arch").lowercase()
    val osDir = when {
        os.contains("win") -> "windows"
        os.contains("mac") || os.contains("darwin") -> "osx"
        else -> "linux"
    }
    val archDir = when (arch) {
        "amd64", "x86_64" -> "x86_64"
        "aarch64", "arm64" -> "aarch64"
        else -> arch
    }
    return "$osDir-$archDir"
}
