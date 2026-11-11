# syntax=docker/dockerfile:1

# ---------- build ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore first (cached unless the project file changes).
COPY Directory.Build.props ./
COPY src/SchoolAdmission.Api/SchoolAdmission.Api.csproj src/SchoolAdmission.Api/
RUN dotnet restore src/SchoolAdmission.Api/SchoolAdmission.Api.csproj

COPY src/ src/
RUN dotnet publish src/SchoolAdmission.Api/SchoolAdmission.Api.csproj \
    --configuration Release --no-restore --output /app/publish /p:UseAppHost=false

# ---------- runtime ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# ASPNETCORE_HTTP_PORTS is preset by the base image; clear it so URLS is the single source (avoids a startup warning).
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_HTTP_PORTS= \
    DOTNET_gcServer=1

EXPOSE 8080

# Built-in non-root user of the official .NET images.
USER $APP_UID

# No curl/wget in the runtime image: probe /health with bash's /dev/tcp.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3 && head -n1 <&3 | grep -q ' 200 '"]

ENTRYPOINT ["dotnet", "SchoolAdmission.Api.dll"]
