# n8n Workflow Requirements for Mogeeb Dashboard

## Overview
This document outlines the exact input and output specifications needed for the n8n workflows to ensure the Mogeeb Dashboard functions perfectly with your order management system.

## Required Workflows

### 1. GET Orders Webhook (Data Retrieval)

#### Purpose
Retrieve all active orders from the database to display in the dashboard.

#### Webhook Configuration
- **Method**: GET
- **Path**: `/webhook/get-orders` (or any custom path)
- **Response Mode**: Respond to Webhook
- **CORS**: Enabled (Allow all origins: `*`)

#### Expected Output Format
The webhook must return a JSON array with statistics and orders in the following structure:

```json
[
  {
    "stats": {
      "pending_confirmation": 0,
      "confirmed": 8,
      "preparing": 1,
      "out_for_delivery": 3,
      "total_active": 12
    },
    "orders": [
      {
        "order_id": 12345,
        "customer_name": "أحمد محمد",
        "customer_phone": "+201234567890",
        "delivery_address": "شارع النيل، المعادي، القاهرة",
        "order_time_cairo": "2025-11-04 14:30:00",
        "status": "pending_confirmation",
        "total_price": 85.50,
        "order_items": [
          {
            "item_name": "قهوة تركي",
            "quantity": 2,
            "item_price": 15.00
          },
          {
            "item_name": "كروسان بالجبن",
            "quantity": 1,
            "item_price": 25.50
          },
          {
            "item_name": "عصير برتقال",
            "quantity": 3,
            "item_price": 15.00
          }
        ]
      }
    ]
  }
]
```

#### Required Database Query
```sql
-- Get statistics and orders in one query
WITH order_stats AS (
    SELECT 
        COUNT(*) FILTER (WHERE status = 'pending_confirmation') as pending_confirmation,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
        COUNT(*) FILTER (WHERE status = 'preparing') as preparing,
        COUNT(*) FILTER (WHERE status = 'out_for_delivery') as out_for_delivery,
        COUNT(*) as total_active
    FROM orders 
    WHERE status IN ('pending_confirmation', 'confirmed', 'preparing', 'out_for_delivery')
),
order_data AS (
    SELECT 
        o.order_id,
        o.customer_name,
        o.customer_phone,
        o.delivery_address,
        o.order_time_cairo,
        o.status,
        o.total_price,
        JSON_AGG(
            JSON_BUILD_OBJECT(
                'item_name', oi.item_name,
                'quantity', oi.quantity,
                'item_price', oi.item_price
            )
        ) as order_items
    FROM orders o
    LEFT JOIN order_items oi ON o.order_id = oi.order_id
    WHERE o.status IN ('pending_confirmation', 'confirmed', 'preparing', 'out_for_delivery')
    GROUP BY o.order_id, o.customer_name, o.customer_phone, o.delivery_address, o.order_time_cairo, o.status, o.total_price
    ORDER BY o.order_time_cairo DESC
)
SELECT 
    JSON_BUILD_OBJECT(
        'stats', (SELECT row_to_json(order_stats) FROM order_stats),
        'orders', (SELECT JSON_AGG(row_to_json(order_data)) FROM order_data)
    ) as result;
```

#### Status Values
The `status` field must use these exact values:
- `"pending_confirmation"` - في انتظار التأكيد
- `"confirmed"` - مؤكد
- `"preparing"` - قيد التحضير
- `"out_for_delivery"` - في الطريق للتسليم
- `"delivered"` - تم التسليم
- `"canceled"` - ملغي

---

### 2. POST Update Order Status Webhook

#### Purpose
Update the status of a specific order when staff interacts with the dashboard.

#### Webhook Configuration
- **Method**: POST
- **Path**: `/webhook/update-order`
- **Response Mode**: Respond to Webhook
- **CORS**: Enabled (Allow all origins: `*`)

#### Expected Input Format
The dashboard will send this JSON structure:

```json
{
  "order_id": 12345,
  "new_status": "confirmed",
  "updated_by": "dashboard",
  "timestamp": "2025-11-04T14:35:00Z"
}
```

#### Required Processing
1. **Validate Input**:
   - Check if `order_id` exists
   - Verify `new_status` is valid
   - Ensure order can transition to new status

2. **Update Database**:
```sql
UPDATE orders 
SET 
    status = :new_status,
    updated_at = CURRENT_TIMESTAMP,
    updated_by = :updated_by
WHERE order_id = :order_id;
```

3. **Log the Change** (Optional but recommended):
```sql
INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_at)
VALUES (:order_id, :old_status, :new_status, :updated_by, CURRENT_TIMESTAMP);
```

#### Expected Output Format
Return success or error response:

**Success Response:**
```json
{
  "status": "success",
  "message": "Order status updated successfully",
  "order_id": 12345,
  "old_status": "new",
  "new_status": "confirmed",
  "timestamp": "2025-11-04T14:35:00Z"
}
```

**Error Response:**
```json
{
  "status": "error",
  "message": "Order not found or invalid status transition",
  "error_code": "ORDER_NOT_FOUND",
  "order_id": 12345
}
```

---

## Database Schema Requirements

### Orders Table
```sql
CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20),
    delivery_address TEXT,
    order_time_cairo TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'new',
    total_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);
```

### Order Items Table
```sql
CREATE TABLE order_items (
    item_id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(order_id),
    item_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    item_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Order Status History Table (Optional)
```sql
CREATE TABLE order_status_history (
    history_id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(order_id),
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    changed_by VARCHAR(100),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## n8n Workflow Node Structure

### Workflow 1: GET Orders
```
[Webhook Node] → [PostgreSQL Node] → [Response Node]
```

### Workflow 2: Update Order Status
```
[Webhook Node] → [PostgreSQL Update Node] → [Conditional Node] → [Response Node]
                                         ↓
                               [Error Handling Node] → [Error Response Node]
```

---

## Testing Data Examples

### Sample Order Data for Testing
```json
{
  "order_id": 1001,
  "customer_name": "سارة أحمد",
  "customer_phone": "+201098765432",
  "delivery_address": "شارع التحرير، وسط البلد، القاهرة",
  "order_time_cairo": "2025-11-04 16:20:00",
  "status": "pending_confirmation",
  "total_price": 120.75,
  "order_items": [
    {
      "item_name": "لاتيه كبير",
      "quantity": 2,
      "item_price": 25.00
    },
    {
      "item_name": "تشيز كيك",
      "quantity": 1,
      "item_price": 35.00
    },
    {
      "item_name": "سندوتش كلوب",
      "quantity": 1,
      "item_price": 35.75
    }
  ]
}
```

---

## Security Considerations

1. **Input Validation**: Always validate order_id and status values
2. **SQL Injection Prevention**: Use parameterized queries
3. **CORS Configuration**: Set appropriate CORS headers
4. **Rate Limiting**: Consider implementing rate limiting on webhooks
5. **Authentication**: Consider adding API key authentication for production

---

## Performance Optimization

1. **Database Indexing**:
   ```sql
   CREATE INDEX idx_orders_status ON orders(status);
   CREATE INDEX idx_orders_time ON orders(order_time_cairo);
   CREATE INDEX idx_order_items_order_id ON order_items(order_id);
   ```

2. **Caching**: Consider caching frequently accessed data
3. **Connection Pooling**: Use database connection pooling in n8n

---

## Monitoring and Logging

1. **Webhook Logs**: Enable logging in n8n for both webhooks
2. **Error Tracking**: Monitor failed requests and database errors
3. **Performance Metrics**: Track response times and throughput
4. **Status Transition Logs**: Keep audit trail of status changes

---

## Configuration URLs for Dashboard

After setting up the n8n workflows, update these URLs in the dashboard configuration:

1. **GET Orders Webhook**: `https://your-n8n-instance.com/webhook/get-orders`
2. **Update Order Webhook**: `https://your-n8n-instance.com/webhook/update-order`
