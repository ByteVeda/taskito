// A throwaway consumer that drives the SDK's JNI + Jackson paths end to end.
// CI builds it into a GraalVM native image to verify the reachability metadata
// the runtime ships. Not published; not part of the SDK artifact.
plugins {
    application
    checkstyle
    id("com.diffplug.spotless") version "6.25.0"
    id("org.graalvm.buildtools.native") version "0.10.6"
}

group = "org.byteveda"
version = "0.17.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation(project(":"))
}

application {
    mainClass.set("org.byteveda.taskito.graalvm.Smoke")
}

graalvmNative {
    binaries.named("main") {
        // Fail the build on missing metadata rather than emitting a fallback image.
        buildArgs.add("--no-fallback")
    }
    // CI runs the smoke under the tracing agent (`-Pagent :graalvm-smoke:run`)
    // then `metadataCopy` to populate this module's resources, so `nativeCompile`
    // sees the JNI/reflection metadata the SDK's JNI + Jackson paths require.
    agent {
        metadataCopy {
            inputTaskNames.add("run")
            outputDirectories.add("src/main/resources/META-INF/native-image")
            mergeWithExisting.set(true)
        }
    }
}

spotless {
    java {
        target("src/**/*.java")
        palantirJavaFormat("2.50.0")
        removeUnusedImports()
        trimTrailingWhitespace()
        endWithNewline()
    }
}

checkstyle {
    toolVersion = "10.21.4"
    configFile = file("../config/checkstyle/checkstyle.xml")
    isIgnoreFailures = false
}
