export interface QuarkusBootstrapPomParams {
  groupId: string;
  artifactId: string;
  version?: string;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderBootstrapPom({
  groupId,
  artifactId,
  version = "1.0.0-SNAPSHOT",
}: QuarkusBootstrapPomParams): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>${xmlEscape(groupId)}</groupId>
  <artifactId>${xmlEscape(artifactId)}</artifactId>
  <version>${xmlEscape(version)}</version>

  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <project.reporting.outputEncoding>UTF-8</project.reporting.outputEncoding>
    <quarkus.platform.group-id>io.quarkus.platform</quarkus.platform.group-id>
    <quarkus.platform.artifact-id>quarkus-bom</quarkus.platform.artifact-id>
    <quarkus.platform.version>999-SNAPSHOT</quarkus.platform.version>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>${'${quarkus.platform.group-id}'}</groupId>
        <artifactId>${'${quarkus.platform.artifact-id}'}</artifactId>
        <version>${'${quarkus.platform.version}'}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <build>
    <plugins>
      <plugin>
        <groupId>io.quarkus</groupId>
        <artifactId>quarkus-maven-plugin</artifactId>
        <version>${'${quarkus.platform.version}'}</version>
        <extensions>true</extensions>
      </plugin>
    </plugins>
  </build>
</project>
`;
}
