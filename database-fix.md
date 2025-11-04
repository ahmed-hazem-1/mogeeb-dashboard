# حل مشكلة PostgreSQL ENUM - تحديث حالات الطلبات

## المشكلة
قاعدة البيانات تعرض خطأ: `invalid input value for enum order_status_enum: "completed"`

هذا يعني أن ENUM في PostgreSQL لا يحتوي على القيم الجديدة المطلوبة.

## الحل

### 1. تحديث ENUM في PostgreSQL

قم بتنفيذ هذه الاستعلامات في قاعدة البيانات:

```sql
-- إضافة القيم الجديدة للـ ENUM
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'pending_confirmation';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'out_for_delivery'; 
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'canceled';

-- التحقق من القيم الحالية في الـ ENUM
SELECT enumlabel FROM pg_enum WHERE enumtypid = (
    SELECT oid FROM pg_type WHERE typname = 'order_status_enum'
) ORDER BY enumsortorder;
```

### 2. إذا كان ENUM غير موجود، قم بإنشائه:

```sql
-- إنشاء ENUM جديد
CREATE TYPE order_status_enum AS ENUM (
    'pending_confirmation',
    'confirmed', 
    'preparing',
    'out_for_delivery',
    'delivered',
    'canceled'
);

-- تحديث جدول الطلبات لاستخدام ENUM
ALTER TABLE orders 
ALTER COLUMN status TYPE order_status_enum 
USING status::order_status_enum;
```

### 3. إذا كانت هناك قيم قديمة في قاعدة البيانات:

```sql
-- تحديث القيم القديمة
UPDATE orders SET status = 'delivered' WHERE status = 'completed';
UPDATE orders SET status = 'pending_confirmation' WHERE status = 'new';
UPDATE orders SET status = 'out_for_delivery' WHERE status = 'ready';
UPDATE orders SET status = 'canceled' WHERE status = 'cancelled';

-- التحقق من وجود قيم غير صحيحة
SELECT DISTINCT status FROM orders 
WHERE status NOT IN ('pending_confirmation', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'canceled');
```

### 4. إعادة إنشاء ENUM (الخيار الأقوى إذا فشل ما سبق):

```sql
-- إنشاء ENUM مؤقت
CREATE TYPE order_status_enum_new AS ENUM (
    'pending_confirmation',
    'confirmed', 
    'preparing',
    'out_for_delivery',
    'delivered',
    'canceled'
);

-- تحديث الجدول لاستخدام ENUM الجديد
ALTER TABLE orders 
ALTER COLUMN status TYPE order_status_enum_new 
USING (
    CASE 
        WHEN status::text = 'completed' THEN 'delivered'::order_status_enum_new
        WHEN status::text = 'new' THEN 'pending_confirmation'::order_status_enum_new
        WHEN status::text = 'ready' THEN 'out_for_delivery'::order_status_enum_new
        WHEN status::text = 'cancelled' THEN 'canceled'::order_status_enum_new
        ELSE status::text::order_status_enum_new
    END
);

-- حذف ENUM القديم وإعادة تسمية الجديد
DROP TYPE order_status_enum;
ALTER TYPE order_status_enum_new RENAME TO order_status_enum;
```

## تحديث n8n Workflow

تأكد من تحديث n8n workflow ليستخدم القيم الجديدة:

### في PostgreSQL Node:
```sql
UPDATE orders 
SET status = $1, updated_at = CURRENT_TIMESTAMP
WHERE order_id = $2;
```

### تأكد من أن Query Parameters يستخدم:
- `new_status` (ليس `completed`)
- `order_id`

## تنظيف Cache المتصفح

1. افتح Developer Tools (F12)
2. انقر بزر الماوس الأيمن على زر Refresh
3. اختر "Empty Cache and Hard Reload"

أو:
- اضغط Ctrl+Shift+R (Windows) أو Cmd+Shift+R (Mac)

## للتحقق من نجاح الإصلاح:

```sql
-- عرض جميع القيم المسموحة في ENUM
SELECT enumlabel FROM pg_enum WHERE enumtypid = (
    SELECT oid FROM pg_type WHERE typname = 'order_status_enum'
) ORDER BY enumsortorder;

-- عرض حالات الطلبات الحالية
SELECT status, COUNT(*) as count 
FROM orders 
GROUP BY status;
```

النتيجة المتوقعة:
```
    enumlabel    
-----------------
 pending_confirmation
 confirmed
 preparing
 out_for_delivery
 delivered
 canceled
```