package com.lagermanager.demo;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.boot.ApplicationRunner;
import static org.junit.jupiter.api.Assertions.*;

class DemoSafetyTests {
    @Test void normalAndTestProfilesHaveNoAutomaticDemoSeedRunner() {
        for (String[] profiles : new String[][] { {}, {"test"}, {"demo", "test"} }) {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.getEnvironment().setActiveProfiles(profiles);
                context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("isolated-demo-url", java.util.Map.of(
                        "spring.datasource.url", "jdbc:mysql://127.0.0.1:3307/lagermanager_demo_test")));
                context.register(DemoConfiguration.class);
                context.refresh();
                assertEquals(0, context.getBeanNamesForType(ApplicationRunner.class).length);
            }
        }
    }
    @Test void populationRejectsUnapprovedDatabaseBeforeAnyDatasourceCanInitialize() {
        java.util.concurrent.atomic.AtomicBoolean initialized = new java.util.concurrent.atomic.AtomicBoolean();
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("demo");
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("unsafe-test-url", java.util.Map.of(
                    "spring.datasource.url", "jdbc:mysql://localhost:3306/lagermanager_demo", "lagermanager.demo.populate", "true", "spring.jpa.hibernate.ddl-auto", "validate")));
            context.register(DemoConfiguration.class);
            context.registerBean("datasourceSentinel", Object.class, () -> { initialized.set(true); return new Object(); });
            var failure = assertThrows(IllegalStateException.class, context::refresh);
            assertTrue(failure.getMessage().contains("explicitly authorized"));
            assertFalse(initialized.get());
        }
    }

    @Test void passwordResetRejectsSchemaUpdateBeforeDatasourceInitialization() {
        java.util.concurrent.atomic.AtomicBoolean initialized = new java.util.concurrent.atomic.AtomicBoolean();
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("demo");
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("reset-guard", java.util.Map.of(
                    "spring.datasource.url", "jdbc:mysql://127.0.0.1:3307/lagermanager_demo_test",
                    "lagermanager.demo.reset-passwords", "true", "spring.jpa.hibernate.ddl-auto", "update")));
            context.register(DemoConfiguration.class);
            context.registerBean("datasourceSentinel", Object.class, () -> { initialized.set(true); return new Object(); });
            var failure = assertThrows(IllegalStateException.class, context::refresh);
            assertTrue(failure.getMessage().contains("no schema changes")); assertFalse(initialized.get());
        }
    }
}
