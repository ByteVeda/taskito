// taskito-test: a pure-Java in-memory QueueBackend for fast unit tests (no JNI,
// no disk). Depends on the runtime for the SPI + models; the runtime does NOT
// depend on it (its own tests live here), so there is no cycle.
plugins {
    `java-library`
    checkstyle
    id("com.diffplug.spotless") version "6.25.0"
}

group = "org.byteveda"
version = "0.16.4"

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
