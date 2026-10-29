package com.lagermanager.support;

import org.springframework.test.context.DynamicPropertyRegistry;

import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.Comparator;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** Owns a fresh local mysqld, never connects to the project's database or reads its configuration. */
public final class DisposableMySql {
    private static Process server;
    private static Path directory;
    private static int port;
    private static final String PASSWORD = UUID.randomUUID().toString();

    private DisposableMySql() { }

    private static Path binary() {
        String override = System.getProperty("lagermanager.test.mysql.binary");
        if (override != null) return Path.of(override);
        for (String candidate : new String[] {"/usr/local/mysql/bin/mysqld", "/opt/homebrew/opt/mysql/bin/mysqld", "/usr/sbin/mysqld"}) {
            if (Files.isExecutable(Path.of(candidate))) return Path.of(candidate);
        }
        return Path.of("/nonexistent/lagermanager-test-mysqld");
    }

    public static boolean isAvailable() { return Files.isExecutable(binary()); }

    public static synchronized void configure(DynamicPropertyRegistry registry, String database) {
        start();
        if (!database.matches("lagermanager_[a-z_]+_test")) throw new IllegalArgumentException("Invalid test database");
        registry.add("spring.datasource.url", () -> url(database));
        registry.add("spring.datasource.username", () -> "root");
        registry.add("spring.datasource.password", () -> PASSWORD);
        registry.add("spring.datasource.driver-class-name", () -> "com.mysql.cj.jdbc.Driver");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
        registry.add("spring.jpa.show-sql", () -> "false");
    }

    private static String url(String database) {
        return "jdbc:mysql://127.0.0.1:" + port + "/" + database
                + "?allowPublicKeyRetrieval=true&useSSL=false&connectTimeout=1000";
    }

    private static void start() {
        if (server != null && server.isAlive()) return;
        if (!isAvailable()) throw new IllegalStateException("Disposable MySQL binary unavailable; no real-database fallback");
        try {
            Path temporaryRoot = Files.isDirectory(Path.of("/private/tmp")) ? Path.of("/private/tmp")
                    : Path.of(System.getProperty("java.io.tmpdir"));
            directory = Files.createTempDirectory(temporaryRoot, "lm-mysql-");
            Path data = directory.resolve("data");
            Path base = binary().toRealPath().getParent().getParent();
            Process initialize = new ProcessBuilder(binary().toString(), "--no-defaults", "--basedir=" + base,
                    "--datadir=" + data, "--initialize-insecure")
                    .redirectErrorStream(true).redirectOutput(directory.resolve("initialize.log").toFile()).start();
            if (!initialize.waitFor(60, TimeUnit.SECONDS) || initialize.exitValue() != 0) {
                initialize.destroyForcibly();
                throw new IllegalStateException("Disposable MySQL initialization failed; inspect temporary test logs");
            }
            try (ServerSocket reservation = new ServerSocket(0)) { port = reservation.getLocalPort(); }
            server = new ProcessBuilder(binary().toString(), "--no-defaults", "--basedir=" + base,
                    "--datadir=" + data, "--port=" + port, "--bind-address=127.0.0.1",
                    "--socket=" + directory.resolve("mysql.sock"), "--pid-file=" + directory.resolve("mysql.pid"),
                    "--mysqlx=0", "--skip-log-bin", "--innodb-buffer-pool-size=32M", "--performance-schema=OFF")
                    .redirectErrorStream(true).redirectOutput(directory.resolve("server.log").toFile()).start();
            Runtime.getRuntime().addShutdownHook(new Thread(DisposableMySql::stop));
            long deadline = System.nanoTime() + Duration.ofSeconds(45).toNanos();
            while (System.nanoTime() < deadline) {
                if (!server.isAlive()) throw new IllegalStateException("Disposable MySQL exited before startup");
                try (Connection connection = DriverManager.getConnection(url(""), "root", "")) {
                    // Verify ownership before any writes; a port collision must never mutate another server.
                    try (var statement = connection.createStatement(); var result = statement.executeQuery("SELECT @@datadir")) {
                        result.next();
                        if (!Path.of(result.getString(1)).toRealPath().equals(data.toRealPath())) {
                            throw new IllegalStateException("Refusing non-disposable database");
                        }
                    }
                    try (var statement = connection.createStatement()) {
                        statement.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY '" + PASSWORD + "'");
                        statement.execute("CREATE DATABASE lagermanager_context_test");
                        statement.execute("CREATE DATABASE lagermanager_reference_test");
                        statement.execute("CREATE DATABASE lagermanager_demo_test");
                    }
                    return;
                } catch (java.sql.SQLException unavailable) { Thread.sleep(100); }
            }
            throw new IllegalStateException("Disposable MySQL startup timed out");
        } catch (Exception exception) {
            stop();
            throw new IllegalStateException("Cannot start isolated MySQL; no real-database fallback", exception);
        }
    }

    private static void stop() {
        if (server != null) {
            server.destroy();
            try {
                if (!server.waitFor(10, TimeUnit.SECONDS)) server.destroyForcibly().waitFor();
            } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        if (directory != null && (server == null || !server.isAlive())) {
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            } catch (Exception ignored) { /* Only generated temporary files may remain on cleanup failure. */ }
        }
    }
}
