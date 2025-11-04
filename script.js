// إعدادات التطبيق
// نقوم بجلب الإعدادات من localStorage إذا وجدت، وإلا نستخدم الإعدادات الافتراضية
const getStoredConfig = () => {
    const storedConfig = localStorage.getItem('mogeebConfig');
    return storedConfig ? JSON.parse(storedConfig) : null;
};

const CONFIG = getStoredConfig() || {
    // رابط الـ webhook لجلب الطلبات (GET)
    GET_ORDERS_WEBHOOK: 'https://biometrical-bettina-benignly.ngrok-free.dev/webhook/webhook/get-orders',
    
    // رابط الـ webhook لتحديث حالة الطلب (POST) - سيحتاج إلى إنشاؤه في n8n
    UPDATE_ORDER_WEBHOOK: 'https://antoinette-nonmimetic-boringly.ngrok-free.dev/webhook/update-order',
    
    // فترة التحديث التلقائي بالميلي ثانية (30 ثانية)
    AUTO_REFRESH_INTERVAL: 30000,
    
    // الحد الأقصى لعدد المحاولات عند فشل الطلب
    MAX_RETRY_ATTEMPTS: 3,
    
    // وقت الانتظار بين المحاولات (بالميلي ثانية)
    RETRY_DELAY: 2000
};

// متغيرات عامة
let currentOrders = [];
let autoRefreshTimer = null;
let isAutoRefreshEnabled = true;
let retryAttempts = 0;
let lastOrderIds = new Set();

// عناصر DOM
const elements = {
    ordersContainer: document.getElementById('ordersContainer'),
    loadingContainer: document.getElementById('loadingContainer'),
    errorContainer: document.getElementById('errorContainer'),
    noOrdersContainer: document.getElementById('noOrdersContainer'),
    totalOrders: document.getElementById('totalOrders'),
    confirmedOrders: document.getElementById('confirmedOrders'),
    preparingOrders: document.getElementById('preparingOrders'),
    lastUpdate: document.getElementById('lastUpdate'),
    connectionStatus: document.getElementById('connectionStatus'),
    silentRefreshIndicator: document.getElementById('silentRefreshIndicator'),
    refreshBtn: document.getElementById('refreshBtn'),
    toggleAutoRefresh: document.getElementById('toggleAutoRefresh'),
    autoRefreshText: document.getElementById('autoRefreshText'),
    confirmModal: document.getElementById('confirmModal'),
    confirmYes: document.getElementById('confirmYes'),
    confirmNo: document.getElementById('confirmNo'),
    confirmMessage: document.getElementById('confirmMessage'),
    errorText: document.getElementById('errorText'),
    notificationSound: document.getElementById('notificationSound')
};

// تهيئة التطبيق عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', function() {
    console.log('تم تحميل لوحة التحكم');
    initializeApp();
});

// تهيئة التطبيق
function initializeApp() {
    // طلب إذن الإشعارات
    requestNotificationPermission();
    
    // إعداد مستمعي الأحداث
    setupEventListeners();
    
    // تحميل الطلبات الأولي
    loadOrders();
    
    // بدء التحديث التلقائي
    startAutoRefresh();
    
    console.log('تم تهيئة التطبيق بنجاح');
}

// طلب إذن الإشعارات
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// إعداد مستمعي الأحداث
function setupEventListeners() {
    // زر التحديث اليدوي
    elements.refreshBtn.addEventListener('click', () => {
        console.log('تم النقر على زر التحديث');
        loadOrders(false); // تحديث مرئي عند النقر على الزر
    });
    
    // زر تبديل التحديث التلقائي
    elements.toggleAutoRefresh.addEventListener('click', toggleAutoRefresh);
    
    // أزرار نافذة التأكيد
    elements.confirmYes.addEventListener('click', confirmOrderUpdate);
    elements.confirmNo.addEventListener('click', closeConfirmModal);
    
    // إغلاق النافذة عند النقر خارجها
    elements.confirmModal.addEventListener('click', function(e) {
        if (e.target === elements.confirmModal) {
            closeConfirmModal();
        }
    });
    
    // مستمع أحداث لوحة المفاتيح
    document.addEventListener('keydown', function(e) {
        // إغلاق النافذة بالضغط على Escape
        if (e.key === 'Escape' && elements.confirmModal.style.display === 'block') {
            closeConfirmModal();
        }
        
        // تحديث بالضغط على F5
        if (e.key === 'F5') {
            e.preventDefault();
            loadOrders();
        }
    });
}

// تحميل الطلبات من الخادم
async function loadOrders(silentRefresh = false) {
    console.log('بدء تحميل الطلبات...');
    
    // إظهار حالة التحميل فقط إذا لم يكن تحديث خفي
    if (!silentRefresh) {
        showLoading();
        updateConnectionStatus('جاري الاتصال...', false);
    } else {
        // إظهار مؤشر التحديث الخفي
        elements.silentRefreshIndicator.style.display = 'inline';
    }
    
    try {
        const response = await fetchWithRetry(CONFIG.GET_ORDERS_WEBHOOK, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        if (!response.ok) {
            throw new Error(`خطأ HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('تم استلام البيانات:', data);
        
        // معالجة البيانات
        processOrdersData(data);
        
        // تحديث حالة الاتصال
        updateConnectionStatus('متصل', true);
        
        // إخفاء مؤشر التحديث الخفي
        if (silentRefresh) {
            elements.silentRefreshIndicator.style.display = 'none';
        }
        
        // تحديث وقت آخر تحديث
        updateLastUpdateTime();
        
        // إعادة تعيين عداد المحاولات
        retryAttempts = 0;
        
        console.log('تم تحميل الطلبات بنجاح');
        
    } catch (error) {
        console.error('خطأ في تحميل الطلبات:', error);
        
        // إخفاء مؤشر التحديث الخفي في حالة الخطأ
        if (silentRefresh) {
            elements.silentRefreshIndicator.style.display = 'none';
        }
        
        handleLoadError(error, silentRefresh);
    }
}

// جلب البيانات مع إعادة المحاولة
async function fetchWithRetry(url, options, attempts = CONFIG.MAX_RETRY_ATTEMPTS) {
    for (let i = 0; i < attempts; i++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (error) {
            console.warn(`محاولة ${i + 1} فشلت:`, error);
            
            if (i === attempts - 1) {
                throw error;
            }
            
            // انتظار قبل المحاولة التالية
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
        }
    }
}

// معالجة بيانات الطلبات
function processOrdersData(data) {
    // التأكد من أن البيانات في التنسيق الصحيح
    let orders = Array.isArray(data) ? data : (data.orders || []);
    
    if (!Array.isArray(orders)) {
        console.warn('تنسيق البيانات غير صحيح:', data);
        orders = [];
    }
    
    // فلترة الطلبات النشطة فقط (ليست completed أو cancelled)
    orders = orders.filter(order => 
        order.status && 
        !['completed', 'cancelled'].includes(order.status.toLowerCase())
    );
    
    console.log(`تم العثور على ${orders.length} طلب نشط`);
    
    // التحقق من الطلبات الجديدة
    checkForNewOrders(orders);
    
    // تحديث الطلبات الحالية
    currentOrders = orders;
    
    // عرض الطلبات
    displayOrders(orders);
    
    // تحديث الإحصائيات
    updateStats(orders);
}

// التحقق من الطلبات الجديدة
function checkForNewOrders(newOrders) {
    const newOrderIds = new Set(newOrders.map(order => order.order_id));
    const previousOrderIds = lastOrderIds;
    
    // العثور على الطلبات الجديدة
    const newOrdersList = newOrders.filter(order => 
        !previousOrderIds.has(order.order_id)
    );
    
    if (newOrdersList.length > 0 && lastOrderIds.size > 0) {
        console.log(`تم اكتشاف ${newOrdersList.length} طلب جديد`);
        
        // تشغيل التنبيهات للطلبات الجديدة
        newOrdersList.forEach(order => {
            showNotification(order);
            playNotificationSound();
        });
    }
    
    // تحديث قائمة معرفات الطلبات
    lastOrderIds = newOrderIds;
}

// عرض الطلبات
function displayOrders(orders) {
    // إخفاء حالات التحميل والخطأ
    hideAllStates();
    
    if (orders.length === 0) {
        elements.noOrdersContainer.style.display = 'flex';
        return;
    }
    
    elements.ordersContainer.style.display = 'grid';
    elements.ordersContainer.innerHTML = '';
    
    orders.forEach((order, index) => {
        const orderCard = createOrderCard(order, index);
        elements.ordersContainer.appendChild(orderCard);
    });
}

// إنشاء بطاقة طلب
function createOrderCard(order, index) {
    const card = document.createElement('div');
    card.className = `order-card ${order.status ? order.status.toLowerCase() : 'unknown'}`;
    card.style.animationDelay = `${index * 0.1}s`;
    
    // تحديد ما إذا كان الطلب جديد
    const isNewOrder = !lastOrderIds.has(order.order_id) && lastOrderIds.size > 0;
    if (isNewOrder) {
        card.classList.add('new-order');
    }
    
    card.innerHTML = `
        <div class="order-header">
            <div class="order-id">طلب #${order.order_id}</div>
            <div class="order-status ${order.status ? order.status.toLowerCase() : 'unknown'}">
                ${getStatusText(order.status)}
            </div>
        </div>
        
        <div class="order-time">
            ⏰ ${formatOrderTime(order.order_time_cairo)}
        </div>
        
        <div class="customer-info">
            <h4>بيانات العميل</h4>
            <div class="customer-detail">
                <strong>الاسم:</strong> ${order.customer_name || 'غير محدد'}
            </div>
            <div class="customer-detail">
                <strong>الهاتف:</strong> ${order.customer_phone || 'غير محدد'}
            </div>
            <div class="customer-detail">
                <strong>العنوان:</strong> ${order.delivery_address || 'غير محدد'}
            </div>
        </div>
        
        <div class="order-items">
            <h4>تفاصيل الطلب</h4>
            <div class="items-list">
                ${createItemsList(order.order_items)}
            </div>
        </div>
        
        <div class="total-price">
            💰 المجموع: ${formatPrice(order.total_price)} جنيه
        </div>
        
        <div class="order-actions">
            ${createActionButtons(order)}
        </div>
    `;
    
    return card;
}

// إنشاء قائمة الأصناف
function createItemsList(orderItems) {
    if (!orderItems || !Array.isArray(orderItems)) {
        return '<div class="item">لا توجد تفاصيل للأصناف</div>';
    }
    
    return orderItems.map(item => {
        const quantity = item.quantity || 1;
        // محاولة الحصول على السعر من حقول مختلفة
        const unitPrice = parseFloat(item.item_price || item.price || item.unit_price || 0);
        const totalItemPrice = quantity * unitPrice;
        
        return `
            <div class="item">
                <div class="item-info">
                    <div class="item-name">${item.item_name || 'صنف غير محدد'}</div>
                    <div class="item-quantity">الكمية: ${quantity} × ${formatPrice(unitPrice)} ج</div>
                </div>
                <div class="item-price">${formatPrice(unitPrice)} ج</div>
            </div>
        `;
    }).join('');
}

// إنشاء أزرار التحكم
function createActionButtons(order) {
    const status = order.status ? order.status.toLowerCase() : '';
    
    let buttons = '';
    
    if (status === 'confirmed') {
        buttons += `
            <button class="btn btn-primary" onclick="updateOrderStatus(${order.order_id}, 'preparing', 'بدء تحضير الطلب')">
                🍳 بدء التحضير
            </button>
            <button class="btn btn-success" onclick="updateOrderStatus(${order.order_id}, 'completed', 'إتمام الطلب مباشرة')">
                ✅ إتمام الطلب
            </button>
        `;
    } else if (status === 'preparing') {
        buttons += `
            <button class="btn btn-success" onclick="updateOrderStatus(${order.order_id}, 'completed', 'إتمام الطلب')">
                ✅ الطلب جاهز
            </button>
        `;
    }
    
    return buttons;
}

// تحديث حالة الطلب
function updateOrderStatus(orderId, newStatus, actionText) {
    // حفظ بيانات الطلب المراد تحديثه
    window.pendingOrderUpdate = {
        orderId: orderId,
        newStatus: newStatus,
        actionText: actionText
    };
    
    // عرض نافذة التأكيد
    elements.confirmMessage.textContent = `هل أنت متأكد من ${actionText}؟`;
    elements.confirmModal.style.display = 'block';
}

// تأكيد تحديث الطلب
async function confirmOrderUpdate() {
    if (!window.pendingOrderUpdate) return;
    
    const { orderId, newStatus, actionText } = window.pendingOrderUpdate;
    
    // إغلاق نافذة التأكيد
    closeConfirmModal();
    
    console.log(`جاري تحديث الطلب ${orderId} إلى حالة ${newStatus}`);
    
    try {
        // إرسال طلب التحديث
        const response = await fetch(CONFIG.UPDATE_ORDER_WEBHOOK, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                order_id: orderId,
                new_status: newStatus
            })
        });
        
        if (!response.ok) {
            throw new Error(`خطأ في تحديث الطلب: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('نتيجة التحديث:', result);
        
        // عرض رسالة نجاح
        showSuccessMessage(`تم ${actionText} بنجاح`);
        
        // إعادة تحميل الطلبات بشكل خفي
        setTimeout(() => {
            loadOrders(true);
        }, 1000);
        
    } catch (error) {
        console.error('خطأ في تحديث حالة الطلب:', error);
        showErrorMessage(`فشل في ${actionText}. يرجى المحاولة مرة أخرى.`);
    }
    
    // مسح بيانات الطلب المؤقتة
    window.pendingOrderUpdate = null;
}

// إغلاق نافذة التأكيد
function closeConfirmModal() {
    elements.confirmModal.style.display = 'none';
    window.pendingOrderUpdate = null;
}

// تحديث الإحصائيات
function updateStats(orders) {
    const stats = {
        total: orders.length,
        confirmed: orders.filter(o => o.status && o.status.toLowerCase() === 'confirmed').length,
        preparing: orders.filter(o => o.status && o.status.toLowerCase() === 'preparing').length
    };
    
    elements.totalOrders.textContent = stats.total;
    elements.confirmedOrders.textContent = stats.confirmed;
    elements.preparingOrders.textContent = stats.preparing;
}

// عرض حالة التحميل
function showLoading() {
    hideAllStates();
    elements.loadingContainer.style.display = 'flex';
}

// إخفاء جميع الحالات
function hideAllStates() {
    elements.loadingContainer.style.display = 'none';
    elements.errorContainer.style.display = 'none';
    elements.noOrdersContainer.style.display = 'none';
    elements.ordersContainer.style.display = 'none';
}

// معالجة خطأ التحميل
function handleLoadError(error, silentRefresh = false) {
    console.error('خطأ في التحميل:', error);
    
    // إذا كان تحديث خفي، لا تظهر شاشة الخطأ
    if (!silentRefresh) {
        hideAllStates();
        elements.errorContainer.style.display = 'flex';
        elements.errorText.textContent = `خطأ في الاتصال: ${error.message}`;
    } else {
        // في حالة التحديث الخفي، فقط حدث حالة الاتصال
        console.warn('فشل التحديث الخفي:', error.message);
    }
    
    updateConnectionStatus('منقطع', false);
    
    retryAttempts++;
    
    // إعادة المحاولة التلقائية بعد فترة
    if (retryAttempts <= CONFIG.MAX_RETRY_ATTEMPTS) {
        setTimeout(() => {
            console.log(`إعادة المحاولة ${retryAttempts}...`);
            loadOrders(silentRefresh); // الحفاظ على نوع التحديث
        }, CONFIG.RETRY_DELAY * retryAttempts);
    }
}

// تحديث حالة الاتصال
function updateConnectionStatus(statusText, isConnected) {
    const statusElement = elements.connectionStatus.querySelector('.status-text');
    const dotElement = elements.connectionStatus.querySelector('.status-dot');
    
    statusElement.textContent = statusText;
    
    if (isConnected) {
        dotElement.classList.remove('disconnected');
    } else {
        dotElement.classList.add('disconnected');
    }
}

// تحديث وقت آخر تحديث
function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ar-EG');
    elements.lastUpdate.textContent = timeString;
}

// بدء التحديث التلقائي
function startAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }
    
    autoRefreshTimer = setInterval(() => {
        if (isAutoRefreshEnabled) {
            console.log('تحديث تلقائي خفي...');
            loadOrders(true); // تحديث خفي
        }
    }, CONFIG.AUTO_REFRESH_INTERVAL);
}

// تبديل التحديث التلقائي
function toggleAutoRefresh() {
    isAutoRefreshEnabled = !isAutoRefreshEnabled;
    
    if (isAutoRefreshEnabled) {
        elements.autoRefreshText.textContent = 'إيقاف التحديث التلقائي';
        elements.toggleAutoRefresh.classList.remove('btn-success');
        elements.toggleAutoRefresh.classList.add('btn-secondary');
        startAutoRefresh();
        console.log('تم تفعيل التحديث التلقائي');
    } else {
        elements.autoRefreshText.textContent = 'تفعيل التحديث التلقائي';
        elements.toggleAutoRefresh.classList.remove('btn-secondary');
        elements.toggleAutoRefresh.classList.add('btn-success');
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
        }
        console.log('تم إيقاف التحديث التلقائي');
    }
}

// عرض إشعار للطلب الجديد
function showNotification(order) {
    // إشعار المتصفح
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification('طلب جديد - كافيه فيروز', {
            body: `طلب جديد رقم ${order.order_id} من ${order.customer_name}`,
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiMyN2FlNjAiLz4KPHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4PSIxNiIgeT0iMTYiPgo8cGF0aCBkPSJNOSAxMkwyIDE5bDEuNS0xLjVMNyAxNGwxLTFhMSAxIDAgMDAgLTAuOTEgMS4wOWwtLTAuMDkgMC4wOTEtMSAxIDMgM0wyMCAxMnptMCAwTDIwIDEyeiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+Cjwvc3ZnPgo='
        });
        
        // إغلاق الإشعار تلقائياً بعد 5 ثواني
        setTimeout(() => notification.close(), 5000);
    }
    
    // تسجيل في وحدة التحكم
    console.log('🆕 طلب جديد:', order);
}

// تشغيل صوت التنبيه
function playNotificationSound() {
    try {
        elements.notificationSound.currentTime = 0;
        elements.notificationSound.play().catch(error => {
            console.warn('فشل في تشغيل صوت التنبيه:', error);
        });
    } catch (error) {
        console.warn('خطأ في تشغيل الصوت:', error);
    }
}

// عرض رسالة نجاح
function showSuccessMessage(message) {
    // يمكن تطوير هذه الوظيفة لعرض toast notification
    console.log('✅ نجح:', message);
    
    // إشعار مؤقت
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('كافيه فيروز', {
            body: message,
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMzIiIGZpbGw9IiMyN2FlNjAiLz4KPHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4PSIxNiIgeT0iMTYiPgo8cGF0aCBkPSJNOSAxNmwzIDNjNCA0IDExIDQgMTUgMGwtMy0zYy0yIDItOCAyLTEwIDB6IiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4KPC9zdmc+Cg=='
        });
    }
}

// عرض رسالة خطأ
function showErrorMessage(message) {
    console.error('❌ خطأ:', message);
    alert(message); // يمكن استبداله بـ toast notification أكثر تطوراً
}

// دوال مساعدة

// تنسيق وقت الطلب
function formatOrderTime(timeString) {
    if (!timeString) return 'غير محدد';
    
    try {
        const date = new Date(timeString);
        return date.toLocaleString('ar-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        return timeString;
    }
}

// تنسيق السعر
function formatPrice(price) {
    if (price === null || price === undefined || price === '' || isNaN(price)) return '0';
    
    const numPrice = parseFloat(price);
    if (isNaN(numPrice)) return '0';
    
    return numPrice.toLocaleString('ar-EG', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

// الحصول على نص الحالة
function getStatusText(status) {
    const statusMap = {
        'confirmed': 'مؤكد',
        'preparing': 'قيد التحضير',
        'completed': 'مكتمل',
        'cancelled': 'ملغي'
    };
    
    return statusMap[status?.toLowerCase()] || status || 'غير معروف';
}

// تنظيف الذاكرة عند إغلاق الصفحة
window.addEventListener('beforeunload', function() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }
});

// مراقبة حالة الاتصال
window.addEventListener('online', function() {
    console.log('تم استعادة الاتصال');
    updateConnectionStatus('متصل', true);
    loadOrders(false); // تحديث مرئي عند استعادة الاتصال
});

window.addEventListener('offline', function() {
    console.log('انقطع الاتصال');
    updateConnectionStatus('منقطع', false);
});

// تصدير الدوال للاستخدام العام
window.updateOrderStatus = updateOrderStatus;
window.loadOrders = loadOrders;