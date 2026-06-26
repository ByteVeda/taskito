package org.byteveda.taskito.processor;

import java.io.IOException;
import java.io.Writer;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.annotation.processing.AbstractProcessor;
import javax.annotation.processing.RoundEnvironment;
import javax.annotation.processing.SupportedAnnotationTypes;
import javax.annotation.processing.SupportedSourceVersion;
import javax.lang.model.SourceVersion;
import javax.lang.model.element.AnnotationMirror;
import javax.lang.model.element.AnnotationValue;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.Modifier;
import javax.lang.model.element.TypeElement;
import javax.tools.Diagnostic;
import javax.tools.JavaFileObject;

/**
 * Generates, for each class with {@code @TaskHandler} methods, a {@code <Class>Tasks}
 * companion holding a typed {@code Task} constant per handler plus a static
 * {@code bind(Worker.Builder, <Class>)}. Reads the annotation structurally, so it
 * needs no dependency on the runtime module.
 */
@SupportedAnnotationTypes(TaskHandlerProcessor.ANNOTATION)
@SupportedSourceVersion(SourceVersion.RELEASE_11)
public final class TaskHandlerProcessor extends AbstractProcessor {
    static final String ANNOTATION = "org.byteveda.taskito.annotation.TaskHandler";

    @Override
    public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment roundEnv) {
        TypeElement marker = processingEnv.getElementUtils().getTypeElement(ANNOTATION);
        if (marker == null) {
            return false;
        }
        // Group handler methods by their enclosing class.
        Map<TypeElement, List<ExecutableElement>> byClass = new LinkedHashMap<>();
        for (Element element : roundEnv.getElementsAnnotatedWith(marker)) {
            if (element.getKind() != ElementKind.METHOD) {
                continue;
            }
            ExecutableElement method = (ExecutableElement) element;
            if (!validate(method)) {
                continue;
            }
            TypeElement owner = (TypeElement) method.getEnclosingElement();
            byClass.computeIfAbsent(owner, key -> new java.util.ArrayList<>()).add(method);
        }
        byClass.forEach(this::generate);
        return true;
    }

    private boolean validate(ExecutableElement method) {
        if (method.getParameters().size() != 1) {
            error(method, "@TaskHandler method must take exactly one parameter (the payload)");
            return false;
        }
        if (method.getModifiers().contains(Modifier.PRIVATE)) {
            error(method, "@TaskHandler method must not be private");
            return false;
        }
        if (method.getModifiers().contains(Modifier.STATIC)) {
            error(method, "@TaskHandler method must not be static");
            return false;
        }
        return true;
    }

    private void generate(TypeElement owner, List<ExecutableElement> methods) {
        String pkg = packageOf(owner);
        String ownerSimple = owner.getSimpleName().toString();
        String companion = ownerSimple + "Tasks";
        String qualified = pkg.isEmpty() ? companion : pkg + "." + companion;

        StringBuilder out = new StringBuilder();
        if (!pkg.isEmpty()) {
            out.append("package ").append(pkg).append(";\n\n");
        }
        out.append("import com.fasterxml.jackson.core.type.TypeReference;\n")
                .append("import org.byteveda.taskito.task.Task;\n")
                .append("import org.byteveda.taskito.worker.Handler;\n")
                .append("import org.byteveda.taskito.worker.HandlerRegistry;\n")
                .append("import org.byteveda.taskito.worker.Worker;\n\n")
                .append("/** Generated task descriptors + worker binding for {@link ")
                .append(ownerSimple)
                .append("}. */\n")
                .append("public final class ")
                .append(companion)
                .append(" {\n")
                .append("    private ")
                .append(companion)
                .append("() {}\n\n");

        for (ExecutableElement method : methods) {
            String constant = upperSnake(method.getSimpleName().toString());
            String payloadType = method.getParameters().get(0).asType().toString();
            String name = taskName(method);
            out.append("    public static final Task<")
                    .append(payloadType)
                    .append("> ")
                    .append(constant)
                    .append(" = Task.of(\"")
                    .append(escape(name))
                    .append("\", new TypeReference<")
                    .append(payloadType)
                    .append(">() {})")
                    .append(options(method))
                    .append(";\n\n");
        }

        out.append("    public static Worker.Builder bind(Worker.Builder builder, ")
                .append(ownerSimple)
                .append(" impl) {\n");
        for (ExecutableElement method : methods) {
            String constant = upperSnake(method.getSimpleName().toString());
            String methodName = method.getSimpleName().toString();
            if (isVoid(method)) {
                out.append("        builder.handle(")
                        .append(constant)
                        .append(", payload -> {\n            impl.")
                        .append(methodName)
                        .append("(payload);\n            return null;\n        });\n");
            } else {
                out.append("        builder.handle(")
                        .append(constant)
                        .append(", impl::")
                        .append(methodName)
                        .append(");\n");
            }
        }
        out.append("        return builder;\n    }\n\n");

        // handlers() — returns a HandlerRegistry for Worker.Builder.register(...).
        out.append("    public static HandlerRegistry handlers(")
                .append(ownerSimple)
                .append(" impl) {\n        return HandlerRegistry.of(\n");
        for (int i = 0; i < methods.size(); i++) {
            ExecutableElement method = methods.get(i);
            String constant = upperSnake(method.getSimpleName().toString());
            String methodName = method.getSimpleName().toString();
            out.append("                Handler.of(").append(constant).append(", ");
            if (isVoid(method)) {
                out.append("payload -> {\n                    impl.")
                        .append(methodName)
                        .append("(payload);\n                    return null;\n                })");
            } else {
                out.append("impl::").append(methodName).append(")");
            }
            out.append(i + 1 < methods.size() ? ",\n" : ");\n");
        }
        out.append("    }\n}\n");

        write(owner, qualified, out.toString());
    }

    /** Build the chained option calls (.queue/.maxRetries/.timeoutMs/.priority) from the annotation. */
    private String options(ExecutableElement method) {
        AnnotationMirror mirror = mirror(method);
        StringBuilder chain = new StringBuilder();
        String queue = stringValue(mirror, "queue", "");
        if (!queue.isEmpty()) {
            chain.append(".queue(\"").append(escape(queue)).append("\")");
        }
        long maxRetries = longValue(mirror, "maxRetries", -1);
        if (maxRetries >= 0) {
            chain.append(".maxRetries(").append(maxRetries).append(")");
        }
        long timeoutMs = longValue(mirror, "timeoutMs", -1);
        if (timeoutMs >= 0) {
            chain.append(".timeoutMs(").append(timeoutMs).append("L)");
        }
        long priority = longValue(mirror, "priority", 0);
        if (priority != 0) {
            chain.append(".priority(").append(priority).append(")");
        }
        return chain.toString();
    }

    private String taskName(ExecutableElement method) {
        String value = stringValue(mirror(method), "value", "");
        return value.isEmpty() ? method.getSimpleName().toString() : value;
    }

    private AnnotationMirror mirror(ExecutableElement method) {
        for (AnnotationMirror mirror : method.getAnnotationMirrors()) {
            if (mirror.getAnnotationType().toString().equals(ANNOTATION)) {
                return mirror;
            }
        }
        return null;
    }

    private String stringValue(AnnotationMirror mirror, String key, String fallback) {
        Object value = rawValue(mirror, key);
        return value == null ? fallback : value.toString();
    }

    private long longValue(AnnotationMirror mirror, String key, long fallback) {
        Object value = rawValue(mirror, key);
        return value instanceof Number ? ((Number) value).longValue() : fallback;
    }

    private Object rawValue(AnnotationMirror mirror, String key) {
        if (mirror == null) {
            return null;
        }
        for (Map.Entry<? extends ExecutableElement, ? extends AnnotationValue> entry :
                mirror.getElementValues().entrySet()) {
            if (entry.getKey().getSimpleName().contentEquals(key)) {
                return entry.getValue().getValue();
            }
        }
        return null;
    }

    private boolean isVoid(ExecutableElement method) {
        return method.getReturnType().getKind() == javax.lang.model.type.TypeKind.VOID;
    }

    private String packageOf(TypeElement type) {
        return processingEnv
                .getElementUtils()
                .getPackageOf(type)
                .getQualifiedName()
                .toString();
    }

    private void write(Element origin, String qualifiedName, String source) {
        try {
            JavaFileObject file = processingEnv.getFiler().createSourceFile(qualifiedName, origin);
            try (Writer writer = file.openWriter()) {
                writer.write(source);
            }
        } catch (IOException e) {
            error(origin, "failed to write " + qualifiedName + ": " + e.getMessage());
        }
    }

    private void error(Element element, String message) {
        processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR, message, element);
    }

    /** {@code sendEmail} -> {@code SEND_EMAIL}. */
    private static String upperSnake(String camel) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < camel.length(); i++) {
            char c = camel.charAt(i);
            if (Character.isUpperCase(c) && i > 0) {
                out.append('_');
            }
            out.append(Character.toUpperCase(c));
        }
        return out.toString();
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
