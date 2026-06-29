// Standalone compile-time annotation processor for @TaskHandler. Dependency-free
// (reads annotations structurally via javax.lang.model), so it never forms a
// cycle with the runtime it serves. Consumers add it via `annotationProcessor`.
plugins {
    `java-library`
    checkstyle
    id("com.diffplug.spotless") version "7.2.1"
}

group = "org.byteveda"
version = "0.18.0"

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
}

repositories {
    mavenCentral()
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
