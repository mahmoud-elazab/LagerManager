package com.lagermanager.lowstock;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@ConditionalOnProperty(name = "lagermanager.low-stock.enabled", havingValue = "true")
@EnableScheduling
public class LowStockSchedulingConfiguration {
    @Bean
    LowStockJob lowStockJob(LowStockCheck check,
            @Value("${lagermanager.low-stock.threshold:10}") long threshold,
            @Value("${lagermanager.low-stock.interval:PT2H}") String interval) {
        return new LowStockJob(check, threshold, interval);
    }
}
