package org.byteveda.taskito;

import java.util.List;
import org.byteveda.taskito.annotation.TaskHandler;

/** Test fixture: the {@code @TaskHandler} processor turns this into a generated {@code GreeterTasks}. */
class Greeter {

    @TaskHandler("greet")
    String greet(String name) {
        return "hello " + name;
    }

    @TaskHandler
    Integer total(List<Integer> numbers) {
        return numbers.stream().mapToInt(Integer::intValue).sum();
    }
}
