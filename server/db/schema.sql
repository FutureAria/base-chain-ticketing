-- TicketBlockChain Community DB Schema
-- MySQL 기준

CREATE DATABASE IF NOT EXISTS ticketblockchain
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE ticketblockchain;

-- 유저
CREATE TABLE users (
    user_id     VARCHAR(50)  PRIMARY KEY,
    nickname    VARCHAR(50)  NOT NULL
);

-- 게시글
CREATE TABLE posts (
    post_id     INT          PRIMARY KEY AUTO_INCREMENT,
    user_id     VARCHAR(50)  NOT NULL,
    title       VARCHAR(255) NOT NULL,
    excerpt     TEXT,
    content     TEXT         NOT NULL,
    category    ENUM('ticket', 'fragment', 'baseball', 'strategy') NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    view_count  INT          NOT NULL DEFAULT 0,
    like_count  INT          NOT NULL DEFAULT 0,
    hidden      BOOLEAN      NOT NULL DEFAULT FALSE,
    deleted     BOOLEAN      NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- 댓글 (parent_id NULL이면 일반 댓글, 값 있으면 대댓글)
CREATE TABLE comments (
    comment_id  INT          PRIMARY KEY AUTO_INCREMENT,
    post_id     INT          NOT NULL,
    user_id     VARCHAR(50)  NOT NULL,
    content     TEXT         NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME,
    parent_id   INT          DEFAULT NULL,
    hidden      BOOLEAN      NOT NULL DEFAULT FALSE,
    deleted     BOOLEAN      NOT NULL DEFAULT FALSE,
    FOREIGN KEY (post_id)   REFERENCES posts(post_id),
    FOREIGN KEY (user_id)   REFERENCES users(user_id),
    FOREIGN KEY (parent_id) REFERENCES comments(comment_id)
);

-- 게시글 좋아요 (user_id + post_id 복합 PK로 중복 방지)
CREATE TABLE post_likes (
    user_id     VARCHAR(50)  NOT NULL,
    post_id     INT          NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id),
    FOREIGN KEY (user_id)   REFERENCES users(user_id),
    FOREIGN KEY (post_id)   REFERENCES posts(post_id)
);
