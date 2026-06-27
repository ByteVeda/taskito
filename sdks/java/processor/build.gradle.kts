// Standalone compile-time annotation processor for @TaskHandler. Dependency-free
// (reads annotations structurally via javax.lang.model), so it never forms a
// cycle with the runtime it serves. Consumers add it via `annotationProcessor`.
plugins {
    `java-library`
    checkstyle
    id("com.diffplug.spotless") version "6.25.0"
}

group = "org.byteveda"
version = "0.17.0"

java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(11)
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
