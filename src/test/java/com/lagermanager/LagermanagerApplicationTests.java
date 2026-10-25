package com.lagermanager;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.security.SecureRandom;
import java.util.Base64;

@SpringBootTest
class LagermanagerApplicationTests {

	@DynamicPropertySource
	static void jwtTestProperties(DynamicPropertyRegistry registry) {
		// Ephemeral test-only secret; never used by the production application.
		byte[] testOnlyKey = new byte[32];
		new SecureRandom().nextBytes(testOnlyKey);
		String testOnlySecret = Base64.getEncoder().encodeToString(testOnlyKey);
		registry.add("LAGERMANAGER_JWT_SECRET", () -> testOnlySecret);
	}

	@Test
	void contextLoads() {
	}

}
