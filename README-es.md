<div align="center">

# dsh-store-replenish

> **Repositorio oficial. El único repositorio oficial de este paquete, mantenido por PerryLink. Apache-2.0.**

</div>

Convierte una tabla CSV de ventas e inventario por tienda-SKU en sugerencias de reposición por SKU, un pedido de reposición por tienda y un CSV de reposición. Fórmula: media diaria × (días de ciclo + días de seguridad) − existencias − en tránsito, redondeado hacia arriba al MOQ. Marca los SKU de baja rotación (más de 60 días) y el riesgo de ruptura de stock. Todo se ejecuta localmente: sin red, sin envío de datos y sin modificar el CSV original.

La muestra incluida es sintética (2 tiendas × 8 SKU) e incluye un SKU de baja rotación y dos con riesgo de ruptura. La salida de referencia se genera con una ejecución real y la captura de pantalla procede de la terminal.

## Documentación completa

La documentación completa (instalación, formato de entrada, reglas de MOQ, permisos, ejemplos y solución de problemas) está en [README.md](README.md) y [README-zh.md](README-zh.md).

## Licencia

Apache-2.0. Véanse `LICENSE`, `NOTICE` y `THIRD-PARTY-NOTICES`.
