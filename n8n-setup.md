# إعدادات n8n المطلوبة

## Workflow للتحديث (POST) - مطلوب إنشاؤه

### 1. إنشاء Workflow جديد في n8n

#### الخطوة الأولى: إضافة Webhook Node
```json
{
  "name": "Update Order Webhook",
  "type": "n8n-nodes-base.webhook",
  "position": [250, 300],
  "parameters": {
    "httpMethod": "POST",
    "path": "update-order",
    "responseMode": "responseNode",
    "options": {
      "allowedOrigins": "*"
    }
  }
}
```

#### الخطوة الثانية: إضافة PostgreSQL Node
```json
{
  "name": "Update Order Status",
  "type": "n8n-nodes-base.postgres",
  "position": [450, 300],
  "parameters": {
    "operation": "executeQuery",
    "query": "UPDATE orders SET status = '{{ $json.body.new_status }}' WHERE order_id = {{ $json.body.order_id }};",
    "additionalFields": {}
  },
  "credentials": {
    "postgres": {
      "id": "your_postgres_credential_id",
      "name": "PostgreSQL account"
    }
  }
}
```

#### الخطوة الثالثة: إضافة Respond to Webhook Node
```json
{
  "name": "Respond to Webhook",
  "type": "n8n-nodes-base.respondToWebhook",
  "position": [650, 300],
  "parameters": {
    "respondWith": "json",
    "responseBody": "={{ { \"status\": \"success\", \"message\": \"Order updated successfully\", \"order_id\": $json.body.order_id, \"new_status\": $json.body.new_status } }}"
  }
}
```

### 2. ربط العقد (Nodes)
- Webhook → PostgreSQL → Respond to Webhook

### 3. تفعيل الـ Workflow
بعد الحفظ، ستحصل على رابط الـ webhook مثل:
```
https://your-ngrok-domain.ngrok-free.dev/webhook/update-order-webhook-id
```

## تحديث إعدادات الواجهة

### في ملف script.js
```javascript
const CONFIG = {
    // رابط الـ webhook للجلب (موجود)
    GET_ORDERS_WEBHOOK: 'https://antoinette-nonmimetic-boringly.ngrok-free.dev/webhook/3661fab8-5e08-446f-869f-8c229d6111ea',
    
    // رابط الـ webhook للتحديث (الجديد)
    UPDATE_ORDER_WEBHOOK: 'https://antoinette-nonmimetic-boringly.ngrok-free.dev/webhook/YOUR_UPDATE_WEBHOOK_ID',
};
```

## اختبار النظام

### 1. اختبار جلب البيانات (GET)
```bash
curl -X GET \
  'https://antoinette-nonmimetic-boringly.ngrok-free.dev/webhook/3661fab8-5e08-446f-869f-8c229d6111ea' \
  -H 'ngrok-skip-browser-warning: true'
```

### 2. اختبار تحديث الطلب (POST)
```bash
curl -X POST \
  'https://antoinette-nonmimetic-boringly.ngrok-free.dev/webhook/YOUR_UPDATE_WEBHOOK_ID' \
  -H 'Content-Type: application/json' \
  -H 'ngrok-skip-browser-warning: true' \
  -d '{
    "order_id": 28,
    "new_status": "completed"
  }'
```

## إعدادات قاعدة البيانات

### جدول الطلبات المطلوب
```sql
-- تأكد من وجود هذه الأعمدة في جدول orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'confirmed';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- إنشاء trigger لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_orders_updated_at 
    BEFORE UPDATE ON orders 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
```

### الحالات المدعومة
- `confirmed`: مؤكد
- `preparing`: قيد التحضير  
- `completed`: مكتمل
- `cancelled`: ملغي

## أمان إضافي

### إضافة authentication (اختياري)
```javascript
// في n8n webhook
{
  "authentication": "headerAuth",
  "httpHeaderAuth": {
    "name": "Authorization",
    "value": "Bearer YOUR_SECRET_TOKEN"
  }
}
```

### في الكود:
```javascript
// في script.js
const headers = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    'Authorization': 'Bearer YOUR_SECRET_TOKEN'
};
```

## مراقبة الأخطاء

### في n8n
أضف عقدة للتعامل مع الأخطاء:
```json
{
  "name": "Error Handler",
  "type": "n8n-nodes-base.set",
  "position": [450, 400],
  "parameters": {
    "values": {
      "string": [
        {
          "name": "error",
          "value": "={{ $json.error.message }}"
        }
      ]
    }
  },
  "onError": "continueErrorOutput"
}
```

### تسجيل العمليات
```sql
-- إنشاء جدول لتسجيل تحديثات الطلبات
CREATE TABLE order_status_log (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(order_id),
    old_status VARCHAR(50),
    new_status VARCHAR(50),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT
);

-- إضافة trigger لتسجيل التغييرات
CREATE OR REPLACE FUNCTION log_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_status_log (order_id, old_status, new_status)
        VALUES (NEW.order_id, OLD.status, NEW.status);
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER log_order_status_changes
    AFTER UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION log_status_change();
```