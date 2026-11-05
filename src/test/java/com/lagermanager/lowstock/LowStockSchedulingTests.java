package com.lagermanager.lowstock;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.scheduling.annotation.ScheduledAnnotationBeanPostProcessor;
import org.springframework.test.context.support.TestPropertySourceUtils;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LowStockSchedulingTests {
    @Test void defaultConfigurationRegistersNeitherJobNorScheduler() {
        try (var context = context()) {
            context.refresh();
            assertTrue(context.getBeansOfType(LowStockJob.class).isEmpty());
            assertTrue(context.getBeansOfType(ScheduledAnnotationBeanPostProcessor.class).isEmpty());
            verifyNoInteractions(context.getBean(LowStockCheck.class));
        }
    }

    @Test void explicitFalseAlsoDisablesScheduling() {
        try (var context = context("lagermanager.low-stock.enabled=false")) {
            context.refresh();
            assertTrue(context.getBeansOfType(LowStockJob.class).isEmpty());
            assertTrue(context.getBeansOfType(ScheduledAnnotationBeanPostProcessor.class).isEmpty());
        }
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void defaultIntervalAndInitialDelayAreTwoHours(boolean loadApplicationSettings) throws Exception {
        try (var context = context("lagermanager.low-stock.enabled=true")) {
            if (loadApplicationSettings) {
                context.getEnvironment().getPropertySources().addLast(
                        new org.springframework.core.io.support.ResourcePropertySource("classpath:application.properties"));
            }
            context.refresh();
            var processor = context.getBean(ScheduledAnnotationBeanPostProcessor.class);
            assertEquals(1, processor.getScheduledTasks().size());
            var task = (org.springframework.scheduling.config.FixedDelayTask)
                    processor.getScheduledTasks().iterator().next().getTask();
            assertEquals(java.time.Duration.ofHours(2), task.getIntervalDuration());
            assertEquals(java.time.Duration.ofHours(2), task.getInitialDelayDuration());
            LowStockCheck check = context.getBean(LowStockCheck.class);
            verifyNoInteractions(check);
            context.getBean(LowStockJob.class).run();
            verify(check).check(10);
            verifyNoMoreInteractions(check);
        }
    }

    @Test void optInRegistersOneTaskAndDirectInvocationUsesConfiguredThreshold() {
        try (var context = context("lagermanager.low-stock.enabled=true", "lagermanager.low-stock.interval=PT24H",
                "lagermanager.low-stock.threshold=5")) {
            context.refresh();
            var processor = context.getBean(ScheduledAnnotationBeanPostProcessor.class);
            assertEquals(1, processor.getScheduledTasks().size());
            var task = processor.getScheduledTasks().iterator().next().getTask();
            var interval = (org.springframework.scheduling.config.FixedDelayTask) task;
            assertEquals(java.time.Duration.ofHours(24), interval.getIntervalDuration());
            assertEquals(java.time.Duration.ofHours(24), interval.getInitialDelayDuration());
            LowStockCheck check = context.getBean(LowStockCheck.class);
            verifyNoInteractions(check);
            context.getBean(LowStockJob.class).run();
            verify(check).check(5);
            verifyNoMoreInteractions(check);
        }
    }

    @ParameterizedTest @ValueSource(strings = {"lagermanager.low-stock.threshold=-1", "lagermanager.low-stock.interval=PT0S",
            "lagermanager.low-stock.interval=PT-1S", "lagermanager.low-stock.interval=invalid"})
    void invalidEnabledSettingsFailStartup(String setting) {
        try (var context = context("lagermanager.low-stock.enabled=true", setting)) {
            assertThrows(org.springframework.beans.BeansException.class, context::refresh);
        }
    }

    private AnnotationConfigApplicationContext context(String... properties) {
        var context = new AnnotationConfigApplicationContext();
        TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context, properties);
        context.registerBean(LowStockCheck.class, () -> mock(LowStockCheck.class));
        context.register(LowStockSchedulingConfiguration.class);
        return context;
    }
}
