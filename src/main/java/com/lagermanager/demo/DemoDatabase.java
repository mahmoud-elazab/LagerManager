package com.lagermanager.demo;

import java.net.URI;
import java.util.Set;

public final class DemoDatabase {
    private DemoDatabase() { }
    public static void validate(String url) {
        try {
            if (url == null || !url.startsWith("jdbc:mysql://")) throw new IllegalArgumentException();
            URI uri = URI.create(url.substring(5));
            boolean local = Set.of("localhost", "127.0.0.1").contains(uri.getHost());
            boolean authorized = "/lagermanager".equals(uri.getPath()) && (uri.getPort() == 3306 || uri.getPort() == -1);
            boolean isolatedTest = "/lagermanager_demo_test".equals(uri.getPath());
            if (!local || uri.getUserInfo() != null || (!authorized && !isolatedTest)
                    || (uri.getQuery() != null && uri.getQuery().toLowerCase().contains("createdatabase"))) {
                throw new IllegalArgumentException();
            }
        } catch (RuntimeException invalid) {
            throw new IllegalStateException("Population requires the explicitly authorized local lagermanager database or an isolated test database.");
        }
    }
}
