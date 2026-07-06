/**
 * Worker-side dependency injection: register a resource once, resolve it inside
 * task handlers.
 *
 * <p>Four scopes: {@link org.byteveda.taskito.resources.ResourceScope#WORKER}
 * resources are built lazily once and shared across every task on the worker;
 * {@link org.byteveda.taskito.resources.ResourceScope#THREAD} resources are
 * built lazily once per worker thread and disposed at worker shutdown;
 * {@link org.byteveda.taskito.resources.ResourceScope#TASK} resources are built
 * lazily per task invocation and disposed (LIFO) when it ends; and
 * {@link org.byteveda.taskito.resources.ResourceScope#REQUEST} resources are
 * built fresh on every use and disposed with the task. Handlers resolve them
 * with {@link org.byteveda.taskito.resources.Resources#use(String)}.
 */
package org.byteveda.taskito.resources;
