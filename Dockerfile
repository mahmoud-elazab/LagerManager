FROM eclipse-temurin:21.0.10_7-jdk-jammy AS build
WORKDIR /workspace
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw
COPY src/main/ src/main/
# Verification runs separately against disposable MySQL, never during image construction.
RUN ./mvnw -B -Dmaven.test.skip=true package

FROM eclipse-temurin:21.0.10_7-jre-jammy AS runtime
RUN groupadd --gid 10001 lagermanager \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin lagermanager
WORKDIR /app
COPY --from=build --chown=10001:10001 /workspace/target/lagermanager-0.0.1-SNAPSHOT.jar app.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
