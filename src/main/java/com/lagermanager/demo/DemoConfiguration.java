package com.lagermanager.demo;

import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;

@Configuration
public class DemoConfiguration {
    @Bean
    static BeanFactoryPostProcessor demoDatabaseGuard(Environment environment) {
        return factory -> {
            boolean populate = environment.getProperty("lagermanager.demo.populate", Boolean.class, false);
            boolean reset = environment.getProperty("lagermanager.demo.reset-passwords", Boolean.class, false);
            if (!populate && !reset) return;
            if (populate && reset) throw new IllegalStateException("Choose population or password-only reset, not both.");
            DemoDatabase.validate(environment.getProperty("spring.datasource.url"));
            if (!"validate".equals(environment.getProperty("spring.jpa.hibernate.ddl-auto"))) {
                throw new IllegalStateException("Local population/reset requires --spring.jpa.hibernate.ddl-auto=validate; no schema changes are allowed.");
            }
        };
    }

    @Bean
    @Profile("!test")
    @ConditionalOnExpression("${lagermanager.demo.populate:false} or ${lagermanager.demo.reset-passwords:false}")
    ApplicationRunner demoSeedRunner(DemoSeeder seeder, Environment environment) {
        return args -> {
            var root = java.nio.file.Path.of(environment.getProperty("lagermanager.demo.root", "."));
            if (environment.getProperty("lagermanager.demo.reset-passwords", Boolean.class, false)) {
                seeder.resetPasswords(root);
                org.slf4j.LoggerFactory.getLogger(DemoConfiguration.class).info("Demo application password reset completed.");
            } else {
                var result = seeder.seed(root);
                org.slf4j.LoggerFactory.getLogger(DemoConfiguration.class).info("Local demo population completed: {}", result);
            }
        };
    }
}
