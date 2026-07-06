// Standalone compile-time annotation processor for @TaskHandler. Dependency-free
// (reads annotations structurally via javax.lang.model), so it never forms a
// cycle with the runtime it serves. Consumers add it via `annotationProcessor`.
plugins {
    `java-library`
    checkstyle
    id("com.diffplug.spotless") version "7.2.1"
    id("com.vanniktech.maven.publish") version "0.37.0"
}

group = "org.byteveda"
version = "0.19.0"

mavenPublishing {
    publishToMavenCentral()
    signAllPublications()
    coordinates(group.toString(), "taskito-processor", version.toString())
    pom {
        name.set("Taskito Processor")
        description.set("Compile-time annotation processor generating task-handler bindings for the Taskito JVM SDK.")
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
