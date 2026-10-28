package com.lagermanager.security;

import com.lagermanager.inventory.*;
import com.lagermanager.product.*;
import com.lagermanager.warehouse.*;
import com.lagermanager.user.Role;
import com.lagermanager.user.User;
import com.lagermanager.user.UserRepository;
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.util.Arrays;
import java.util.Base64;
import java.util.Optional;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class RoleAuthorizationTests {
    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    private UserRepository users;
    private ProductService products;
    private WarehouseService warehouses;
    private InventoryService inventoryService;
    private InventoryRepository inventoryRepository;
    private ProductRepository productRepository;
    private WarehouseRepository warehouseRepository;

    @BeforeEach
    void setUp() {
        context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.register(TestConfig.class);
        context.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(context.getBean(FilterChainProxy.class)).build();
        users = context.getBean(UserRepository.class);
        products = context.getBean(ProductService.class);
        warehouses = context.getBean(WarehouseService.class);
        inventoryService = context.getBean(InventoryService.class);
        inventoryRepository = context.getBean(InventoryRepository.class);
        productRepository = context.getBean(ProductRepository.class);
        warehouseRepository = context.getBean(WarehouseRepository.class);
        doReturn(new Inventory()).when(inventoryService).createInventory(any());
        doReturn(new Inventory()).when(inventoryService).updateInventory(anyLong(), any());
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        context.close();
    }

    static Stream<Arguments> permissionMatrix() {
        return Arrays.stream(Role.values()).flatMap(role ->
                Stream.of("products", "warehouses", "inventory").flatMap(resource ->
                        Stream.of("list", "get", "create", "update", "delete")
                                .map(operation -> Arguments.of(role, resource, operation))));
    }

    @ParameterizedTest
    @MethodSource("permissionMatrix")
    void enforcesCrudPermissions(Role role, String resource, String operation) throws Exception {
        boolean allowed = operation.equals("list") || operation.equals("get")
                || role == Role.ADMIN || (role == Role.MANAGER && !operation.equals("delete"));
        mvc.perform(crudRequest(resource, operation).header("Authorization", "Bearer " + token(role)))
                .andExpect(status().is(allowed ? 200 : 403));
        Object relevant = switch (resource) {
            case "products" -> products;
            case "warehouses" -> warehouses;
            default -> inventoryService;
        };
        if (allowed) {
            String expected = switch (operation) {
                case "list" -> switch (resource) {
                    case "products" -> "getAllProducts";
                    case "warehouses" -> "getAllWarehouses";
                    default -> "getAllInventory";
                };
                case "get" -> "get" + singular(resource) + "ById";
                default -> operation + singular(resource);
            };
            var calls = mockingDetails(relevant).getInvocations();
            assertEquals(1, calls.size());
            assertEquals(expected, calls.iterator().next().getMethod().getName());
        } else {
            verifyNoInteractions(products, warehouses, inventoryService,
                    inventoryRepository, productRepository, warehouseRepository);
        }
    }

    static Stream<Arguments> unauthenticatedRequests() {
        return Stream.of("products", "warehouses", "inventory").flatMap(resource ->
                Stream.of("list", "get", "create", "update", "delete").flatMap(operation ->
                        Stream.of("missing", "invalid").map(auth -> Arguments.of(resource, operation, auth))));
    }

    @ParameterizedTest
    @MethodSource("unauthenticatedRequests")
    void unauthenticatedCrudReturns401(String resource, String operation, String auth) throws Exception {
        var request = crudRequest(resource, operation);
        if (auth.equals("invalid")) {
            request.header("Authorization", "Bearer invalid");
        }
        mvc.perform(request).andExpect(status().isUnauthorized());
        verifyNoInteractions(products, warehouses, inventoryService, inventoryRepository);
    }

    @ParameterizedTest
    @EnumSource(Role.class)
    void allRolesCanSetQuantityWithoutChangingAssociations(Role role) throws Exception {
        Product product = new Product();
        product.setId(2L);
        Warehouse warehouse = new Warehouse();
        warehouse.setId(3L);
        Inventory existing = new Inventory(1L, product, warehouse, 10);
        when(inventoryRepository.findById(1L)).thenReturn(Optional.of(existing));
        when(inventoryRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        mvc.perform(patch("/api/inventory/1/quantity").header("Authorization", "Bearer " + token(role))
                        .contentType("application/json")
                        .content("{\"quantity\":25,\"id\":99,\"productId\":99,\"warehouseId\":99,"
                                + "\"product\":{\"id\":99},\"warehouse\":{\"id\":99}}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.quantity").value(25))
                .andExpect(jsonPath("$.id").value(1)).andExpect(jsonPath("$.product.id").value(2))
                .andExpect(jsonPath("$.warehouse.id").value(3));
        assertEquals(25, existing.getQuantity());
        assertEquals(1L, existing.getId());
        assertSame(product, existing.getProduct());
        assertSame(warehouse, existing.getWarehouse());
        verify(inventoryRepository).save(same(existing));
        verifyNoInteractions(productRepository, warehouseRepository);
    }

    @Test
    void employeeCanSetZero() throws Exception {
        Inventory existing = new Inventory(1L, new Product(), new Warehouse(), 10);
        when(inventoryRepository.findById(1L)).thenReturn(Optional.of(existing));
        when(inventoryRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        mvc.perform(patch("/api/inventory/1/quantity").header("Authorization", "Bearer " + token(Role.EMPLOYEE))
                        .contentType("application/json").content("{\"quantity\":0}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.quantity").value(0));
        assertEquals(0, existing.getQuantity());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"quantity\":null}", "{\"quantity\":-1}",
            "{\"quantity\":1.5}", "{\"quantity\":1.0}", "{\"quantity\":\"25\"}",
            "{\"quantity\":\"invalid\"}", "{\"quantity\":true}", "{\"quantity\":{}}",
            "{\"quantity\":[]}", "{\"quantity\":2147483648}", "[]", "null", "", "{"})
    void invalidQuantitiesReturn400WithoutServiceInvocation(String body) throws Exception {
        mvc.perform(patch("/api/inventory/1/quantity").header("Authorization", "Bearer " + token(Role.EMPLOYEE))
                        .contentType("application/json").content(body)).andExpect(status().isBadRequest());
        verifyNoInteractions(inventoryService, inventoryRepository, productRepository, warehouseRepository);
    }

    @Test
    void unknownInventoryReturns404WithoutSaving() throws Exception {
        mvc.perform(patch("/api/inventory/99/quantity").header("Authorization", "Bearer " + token(Role.EMPLOYEE))
                        .contentType("application/json").content("{\"quantity\":25}"))
                .andExpect(status().isNotFound());
        verify(inventoryRepository).findById(99L);
        verify(inventoryRepository, never()).save(any());
        verifyNoInteractions(productRepository, warehouseRepository);
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "invalid"})
    void quantityRequiresAuthentication(String auth) throws Exception {
        var request = patch("/api/inventory/1/quantity").contentType("application/json").content("{\"quantity\":25}");
        if (auth.equals("invalid")) {
            request.header("Authorization", "Bearer invalid");
        }
        mvc.perform(request).andExpect(status().isUnauthorized());
        verifyNoInteractions(inventoryService, inventoryRepository);
    }

    @Test
    void existingTokenFollowsCurrentDatabaseRoleForAuthorization() throws Exception {
        User user = user(Role.ADMIN);
        when(users.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        String token = context.getBean(JwtService.class).generateToken(user);
        user.setRole(Role.EMPLOYEE);
        mvc.perform(delete("/api/products/1").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/inventory/1").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"quantity\":25}"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(products, inventoryService);
        user.setRole(Role.MANAGER);
        mvc.perform(put("/api/products/1").header("Authorization", "Bearer " + token)
                        .contentType("application/json").content("{\"quantity\":0}"))
                .andExpect(status().isOk());
        user.setRole(Role.ADMIN);
        mvc.perform(delete("/api/products/1").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
        verify(products).deleteProduct(1L);
    }

    private String token(Role role) {
        User user = user(role);
        when(users.findByEmail(user.getEmail())).thenReturn(Optional.of(user));
        return context.getBean(JwtService.class).generateToken(user);
    }

    private User user(Role role) {
        User user = new User();
        user.setEmail("isolated@example.com");
        user.setPasswordHash("unused");
        user.setRole(role);
        return user;
    }

    private String singular(String resource) {
        return switch (resource) {
            case "products" -> "Product";
            case "warehouses" -> "Warehouse";
            default -> "Inventory";
        };
    }

    private MockHttpServletRequestBuilder crudRequest(String resource, String operation) {
        HttpMethod method = switch (operation) {
            case "create" -> HttpMethod.POST;
            case "update" -> HttpMethod.PUT;
            case "delete" -> HttpMethod.DELETE;
            default -> HttpMethod.GET;
        };
        String path = "/api/" + resource + (operation.equals("list") || operation.equals("create") ? "" : "/1");
        return request(method, path).contentType("application/json")
                .content(switch (resource) {
                    case "inventory" -> "{\"productId\":2,\"warehouseId\":3,\"quantity\":10}";
                    case "products" -> "{\"quantity\":0}";
                    default -> "{\"capacity\":0}";
                });
    }

    @Configuration
    @EnableWebSecurity
    @EnableWebMvc
    @Import({SecurityConfig.class, ProductController.class, WarehouseController.class, InventoryController.class})
    static class TestConfig {
        @Bean UserRepository userRepository() { return mock(UserRepository.class); }
        @Bean ProductService productService() { return mock(ProductService.class); }
        @Bean WarehouseService warehouseService() { return mock(WarehouseService.class); }
        @Bean InventoryRepository inventoryRepository() { return mock(InventoryRepository.class); }
        @Bean ProductRepository productRepository() { return mock(ProductRepository.class); }
        @Bean WarehouseRepository warehouseRepository() { return mock(WarehouseRepository.class); }
        @Bean InventoryService inventoryService(InventoryRepository inventory, ProductRepository products,
                                               WarehouseRepository warehouses) {
            return spy(new InventoryService(inventory, products, warehouses));
        }
        @Bean CustomUserDetailsService userDetailsService(UserRepository users) {
            return new CustomUserDetailsService(users);
        }
        @Bean JwtService jwtService() {
            return new JwtService(Base64.getEncoder().encodeToString(Jwts.SIG.HS256.key().build().getEncoded()));
        }
    }
}
