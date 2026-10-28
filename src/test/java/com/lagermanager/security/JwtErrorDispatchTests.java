package com.lagermanager.security;

import com.lagermanager.auth.AuthController;
import com.lagermanager.auth.AuthenticationService;
import com.lagermanager.product.ProductController;
import com.lagermanager.product.ProductService;
import com.lagermanager.user.Role;
import com.lagermanager.user.User;
import com.lagermanager.user.UserRepository;
import io.jsonwebtoken.Jwts;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.Filter;
import jakarta.servlet.RequestDispatcher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.context.SecurityContextHolder;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Base64;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(classes = JwtErrorDispatchTests.TestConfig.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class JwtErrorDispatchTests {

    @LocalServerPort
    private int port;

    @Autowired
    private UserRepository repository;
    @Autowired
    private ProductService products;
    @Autowired
    private JwtService jwtService;
    @Autowired
    private AtomicReference<ErrorDispatch> errorDispatch;

    @BeforeEach
    void setUp() {
        reset(repository, products);
        errorDispatch.set(null);
    }

    @Test
    void authenticatedControllerFailurePreserves500ThroughContainerErrorDispatch() throws Exception {
        User user = new User();
        user.setEmail("test@example.com");
        user.setPasswordHash("unused");
        user.setRole(Role.EMPLOYEE);
        when(repository.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        when(products.getAllProducts()).thenAnswer(invocation -> {
            assertTrue(SecurityContextHolder.getContext().getAuthentication().isAuthenticated());
            assertEquals(user.getEmail(), SecurityContextHolder.getContext().getAuthentication().getName());
            throw new IllegalStateException("Intentional regression-test failure");
        });

        HttpResponse<String> response = send(HttpRequest.newBuilder(uri("/api/products"))
                .header("Authorization", "Bearer " + jwtService.generateToken(user)).GET().build());

        assertEquals(500, response.statusCode());
        assertNotNull(errorDispatch.get(), "The embedded container must perform a real ERROR dispatch");
        assertEquals(new ErrorDispatch(DispatcherType.ERROR, "/error", "/api/products", 500),
                errorDispatch.get());
        verify(products).getAllProducts();
        verify(repository, times(1)).findByEmail(user.getEmail());
    }

    @Test
    void ordinaryErrorAndCrudRequestsRemainProtected() throws Exception {
        assertEquals(401, send(HttpRequest.newBuilder(uri("/error")).GET().build()).statusCode());
        assertEquals(401, send(HttpRequest.newBuilder(uri("/api/products")).GET().build()).statusCode());
        assertNull(errorDispatch.get());
        verifyNoInteractions(repository, products);
    }

    @Test
    void loginRemainsPublic() throws Exception {
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri("/api/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{}")).build());
        assertEquals(400, response.statusCode());
        verifyNoInteractions(repository, products);
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private HttpResponse<String> send(HttpRequest request) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(request, HttpResponse.BodyHandlers.ofString());
        }
    }

    record ErrorDispatch(DispatcherType type, String path, Object originalPath, Object status) {
    }

    @Configuration
    @EnableAutoConfiguration(exclude = DataSourceAutoConfiguration.class)
    @Import({SecurityConfig.class, ProductController.class, AuthController.class, AuthenticationService.class})
    static class TestConfig {
        @Bean
        UserRepository userRepository() {
            return mock(UserRepository.class);
        }

        @Bean
        ProductService productService() {
            return mock(ProductService.class);
        }

        @Bean
        CustomUserDetailsService userDetailsService(UserRepository repository) {
            return new CustomUserDetailsService(repository);
        }

        @Bean
        JwtService jwtService() {
            // Ephemeral test-only key; no database or production secret is used.
            return new JwtService(Base64.getEncoder().encodeToString(
                    Jwts.SIG.HS256.key().build().getEncoded()));
        }

        @Bean
        AtomicReference<ErrorDispatch> errorDispatch() {
            return new AtomicReference<>();
        }

        @Bean
        FilterRegistrationBean<Filter> errorDispatchObserver(AtomicReference<ErrorDispatch> observation) {
            FilterRegistrationBean<Filter> registration = new FilterRegistrationBean<>();
            registration.setFilter((request, response, chain) -> {
                var http = (jakarta.servlet.http.HttpServletRequest) request;
                observation.set(new ErrorDispatch(request.getDispatcherType(), http.getRequestURI(),
                        request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI),
                        request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE)));
                chain.doFilter(request, response);
            });
            registration.setDispatcherTypes(DispatcherType.ERROR);
            registration.setOrder(Integer.MIN_VALUE);
            return registration;
        }
    }
}
