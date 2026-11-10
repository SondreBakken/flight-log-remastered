# Post comment

A signed-in viewer leaves a comment on a flight.

```mermaid
sequenceDiagram
    actor Viewer
    participant Session
    participant Comment
    participant Flight
    Viewer->>Comment: post a comment on a flight
    Comment->>Session: identify the author from the session
    alt no signed-in user
        Comment-->>Viewer: refused, sign in to comment
    else signed in
        alt body is blank
            Comment-->>Viewer: refused, write something first
        else 5 or more comments by this author in the last minute
            Comment-->>Viewer: refused, rate limited
        else within limits
            Comment->>Comment: record trimmed comment with the session user as author
            Comment->>Flight: flight page refreshed to show the comment
            Comment-->>Viewer: comment posted
        end
    end
```

## Code

| Element | Path |
|---|---|
| Viewer | src/features/comment-on-flight/actions.ts:22 |
| Session | src/lib/auth/current-user.ts |
| Comment | src/lib/comments/post-comment.ts |
| Flight | src/lib/flightlog/types.ts |
