// taskito-test: a pure-Java in-memory QueueBackend for fast unit tests (no JNI,
// no disk). Depends on the runtime for the SPI + models; the runtime does NOT
// depend on it (its own tests live here), so there is no cycle.
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

dependencies {
    api(project(":"))

    testImplementation(platform("org.junit:junit-bom:5.10.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
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

tasks.test {
    useJUnitPlatform()
}
