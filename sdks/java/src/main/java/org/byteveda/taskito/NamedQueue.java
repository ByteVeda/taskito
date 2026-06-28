package org.byteveda.taskito;

/** Default {@link Queue}: scopes pause/resume to one named queue via its owning client. */
final class NamedQueue implements Queue {
    private final DefaultTaskito owner;
    private final String name;

    NamedQueue(DefaultTaskito owner, String name) {
        this.owner = owner;
        this.name = name;
    }

    @Override
    public String name() {
        return name;
    }

    @Override
    public void pause() {
        owner.pauseLane(name);
    }

    @Override
    public void resume() {
        owner.resumeLane(name);
    }

    @Override
    public boolean isPaused() {
        return owner.listPausedQueues().contains(name);
    }
}
