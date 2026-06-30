/**
 * Worker-side dependency injection: register a resource once, resolve it inside
 * task handlers.
 *
 * <p>Two scopes (mirroring the Node SDK): {@link org.byteveda.taskito.resources.ResourceScope#WORKER}
 * resources are built lazily once and shared across every task on the worker;
 * {@link org.byteveda.taskito.resources.ResourceScope#TASK} resources are built
 * lazily per task invocation and disposed (LIFO) when it ends. Handlers resolve
 * them with {@link org.byteveda.taskito.resources.Resources#use(String)}.
 */
package org.byteveda.taskito.resources;
