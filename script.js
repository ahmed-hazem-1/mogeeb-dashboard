// إعدادات التطبيق
// نقوم بجلب الإعدادات من localStorage إذا وجدت، وإلا نستخدم الإعدادات الافتراضية
const getStoredConfig = () => {
    const storedConfig = localStorage.getItem('mogeebConfig');
    return storedConfig ? JSON.parse(storedConfig) : null;
};

const CONFIG = getStoredConfig() || {
    // رابط الـ webhook لجلب الطلبات (GET)
    GET_ORDERS_WEBHOOK: 'https://mogeeb.shop/webhook/webhook/get-orders',
    
    // رابط الـ webhook لتحديث حالة الطلب (POST) - سيحتاج إلى إنشاؤه في n8n
    UPDATE_ORDER_WEBHOOK: 'https://mogeeb.shop/webhook/webhook/update-order',
    
    // فترة التحديث التلقائي بالميلي ثانية (30 ثانية)
    AUTO_REFRESH_INTERVAL: 30000,
    
    // الحد الأقصى لعدد المحاولات عند فشل الطلب
    MAX_RETRY_ATTEMPTS: 3,
    
    // وقت الانتظار بين المحاولات (بالميلي ثانية)
    RETRY_DELAY: 2000
};

// متغيرات عامة
let currentOrders = [];
let filteredOrders = [];
let activeTab = 'all';
let autoRefreshTimer = null;
let isAutoRefreshEnabled = true;
let retryAttempts = 0;
let lastOrderIds = new Set();
let allOrdersHistory = []; // لتخزين جميع الطلبات بما فيها القديمة للتقارير
let currentReportPeriod = 'today'; // الفترة الزمنية للتقارير

// عناصر DOM
const elements = {
    ordersContainer: document.getElementById('ordersContainer'),
    loadingContainer: document.getElementById('loadingContainer'),
    errorContainer: document.getElementById('errorContainer'),
    noOrdersContainer: document.getElementById('noOrdersContainer'),
    tabsContainer: document.getElementById('tabsContainer'),
    totalOrders: document.getElementById('totalOrders'),
    confirmedOrders: document.getElementById('confirmedOrders'),
    preparingOrders: document.getElementById('preparingOrders'),
    deliveredOrders: document.getElementById('deliveredOrders'),
    // Quick nav stats
    navTotalOrders: document.getElementById('navTotalOrders'),
    navConfirmedOrders: document.getElementById('navConfirmedOrders'),
    navPreparingOrders: document.getElementById('navPreparingOrders'),
    navDeliveredOrders: document.getElementById('navDeliveredOrders'),
    navTodaySales: document.getElementById('navTodaySales'),
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
    notificationSound: document.getElementById('notificationSound'),
    // Tab elements
    tabButtons: document.querySelectorAll('.tab-button'),
    countAll: document.getElementById('countAll'),
    countPending: document.getElementById('countPending'),
    countConfirmed: document.getElementById('countConfirmed'),
    countPreparing: document.getElementById('countPreparing'),
    countDelivery: document.getElementById('countDelivery'),
    countDelivered: document.getElementById('countDelivered')
};

// تهيئة التطبيق عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', function() {
    console.log('تم تحميل لوحة التحكم');
    initializeApp();
});

// تهيئة التطبيق
function initializeApp() {
    // تنظيف أي cache قديم للحالات
    clearOldCache();
    
    // طلب إذن الإشعارات
    requestNotificationPermission();
    
    // إعداد مستمعي الأحداث
    setupEventListeners();
    
    // إعداد مستمعي أحداث التقارير
    setupReportEventListeners();
    
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
    
    // تبديل التابات
    elements.tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const status = button.getAttribute('data-status');
            switchTab(status);
        });
    });
    
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
        const orders = processOrdersData(data);
        
        // تحديث حالة الاتصال
        updateConnectionStatus('متصل', true);
        
        // إخفاء مؤشر التحديث الخفي
        if (silentRefresh) {
            elements.silentRefreshIndicator.style.display = 'none';
        }
        
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
    console.log('البيانات المستلمة:', data);
    
    // التحقق من التنسيق الجديد مع الإحصائيات
    let orders = [];
    let stats = null;
    
    if (Array.isArray(data) && data.length > 0 && data[0].orders) {
        // التنسيق الجديد مع الإحصائيات
        const responseData = data[0];
        orders = responseData.orders || [];
        stats = responseData.stats || null;
        
        console.log('تم العثور على إحصائيات جاهزة:', stats);
    } else if (Array.isArray(data)) {
        // التنسيق القديم - مصفوفة طلبات مباشرة
        orders = data;
    } else if (data && data.orders) {
        // تنسيق كائن يحتوي على orders
        orders = data.orders;
        stats = data.stats;
    } else {
        console.warn('تنسيق البيانات غير صحيح:', data);
        orders = [];
    }
    
    // فلترة الطلبات النشطة فقط (ليست delivered أو canceled)
    orders = orders.filter(order => 
        order.status && 
        !['canceled'].includes(order.status.toLowerCase())
    );
    
    console.log(`تم العثور على ${orders.length} طلب نشط`);
    
    // التحقق من الطلبات الجديدة
    checkForNewOrders(orders);
    
    // تحديث الطلبات الحالية وعرضها
    displayOrders(orders, stats);
    
    // تحديث الإحصائيات
    if (stats) {
        // استخدام الإحصائيات الجاهزة من الخادم
        updateStatsFromServer(stats);
    } else {
        // حساب الإحصائيات محلياً (للتوافق مع النسخة القديمة)
        updateStats(orders);
    }
    
    // تحديث آخر تحديث
    updateLastUpdateTime();
    
    // حفظ جميع الطلبات للتقارير
    allOrdersHistory = orders;
    
    // تحديث التقارير
    updateReports(orders);
    
    return orders;
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
function displayOrders(orders, serverStats = null) {
    // حفظ الطلبات الحالية
    currentOrders = orders;
    
    // إخفاء حالات التحميل والخطأ
    hideAllStates();
    
    if (orders.length === 0) {
        elements.noOrdersContainer.style.display = 'flex';
        elements.tabsContainer.style.display = 'none';
        return;
    }
    
    // إظهار التابات وتحديث العدادات
    elements.tabsContainer.style.display = 'block';
    updateTabCounts(orders, serverStats);
    
    // تطبيق الفلترة حسب التاب النشط
    filterAndDisplayOrders();
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

function createActionButtons(order) {
    const status = order.status ? order.status.toLowerCase() : '';
    
    let buttons = '';
    
    if (status === 'pending_confirmation') {
        buttons += `
            <button class="btn btn-primary" onclick="updateOrderStatus(${order.order_id}, 'confirmed', 'تأكيد الطلب')">
                ✅ تأكيد الطلب
            </button>
            <button class="btn btn-danger" onclick="updateOrderStatus(${order.order_id}, 'canceled', 'إلغاء الطلب')">
                ❌ إلغاء الطلب
            </button>
        `;
    } else if (status === 'confirmed') {
        buttons += `
            <button class="btn btn-primary" onclick="updateOrderStatus(${order.order_id}, 'preparing', 'بدء تحضير الطلب')">
                🍳 بدء التحضير
            </button>
            <button class="btn btn-success" onclick="updateOrderStatus(${order.order_id}, 'out_for_delivery', 'إرسال للتوصيل')">
                🚗 إرسال للتوصيل
            </button>
        `;
    } else if (status === 'preparing') {
        buttons += `
            <button class="btn btn-success" onclick="updateOrderStatus(${order.order_id}, 'out_for_delivery', 'إرسال للتوصيل')">
                🚗 إرسال للتوصيل
            </button>
        `;
    } else if (status === 'out_for_delivery') {
        buttons += `
            <button class="btn btn-success" onclick="updateOrderStatus(${order.order_id}, 'delivered', 'تم تسليم الطلب')">
                ✅ تم التسليم
            </button>
        `;
    }
    
    return buttons;
}

// تحديث حالة الطلب
function updateOrderStatus(orderId, newStatus, actionText) {
    // التحقق من صحة الحالة الجديدة
    const validStatuses = ['pending_confirmation', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'canceled'];
    if (!validStatuses.includes(newStatus)) {
        console.error('حالة غير صحيحة:', newStatus);
        alert('خطأ: حالة الطلب غير صحيحة');
        return;
    }
    
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
    
    // تحضير بيانات الطلب
    const updateData = {
        order_id: orderId,
        new_status: newStatus,
        updated_by: 'dashboard',
        timestamp: new Date().toISOString()
    };
    
    console.log('بيانات التحديث المرسلة:', updateData);
    
    try {
        // إرسال طلب التحديث
        const response = await fetch(CONFIG.UPDATE_ORDER_WEBHOOK, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(updateData)
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
        preparing: orders.filter(o => o.status && ['preparing', 'out_for_delivery'].includes(o.status.toLowerCase())).length,
        delivered: orders.filter(o => o.status && o.status.toLowerCase() === 'delivered').length
    };
    
    // تحديث الإحصائيات القديمة (إذا كانت موجودة)
    if (elements.totalOrders) elements.totalOrders.textContent = stats.total;
    if (elements.confirmedOrders) elements.confirmedOrders.textContent = stats.confirmed;
    if (elements.preparingOrders) elements.preparingOrders.textContent = stats.preparing;
    if (elements.deliveredOrders) elements.deliveredOrders.textContent = stats.delivered;
    
    // تحديث شريط التنقل
    if (elements.navTotalOrders) elements.navTotalOrders.textContent = stats.total;
    if (elements.navConfirmedOrders) elements.navConfirmedOrders.textContent = stats.confirmed;
    if (elements.navPreparingOrders) elements.navPreparingOrders.textContent = stats.preparing;
    if (elements.navDeliveredOrders) elements.navDeliveredOrders.textContent = stats.delivered;
}

// تحديث الإحصائيات من الخادم
function updateStatsFromServer(serverStats) {
    console.log('تحديث الإحصائيات من الخادم:', serverStats);
    
    // تحديث الإحصائيات القديمة (إذا كانت موجودة)
    if (elements.totalOrders) elements.totalOrders.textContent = serverStats.total_active || 0;
    if (elements.confirmedOrders) elements.confirmedOrders.textContent = serverStats.confirmed || 0;
    
    // دمج قيد التحضير مع في الطريق للتسليم
    const preparingTotal = (serverStats.preparing || 0) + (serverStats.out_for_delivery || 0);
    if (elements.preparingOrders) elements.preparingOrders.textContent = preparingTotal;
    
    // تحديث عدد الطلبات المسلمة
    if (elements.deliveredOrders) elements.deliveredOrders.textContent = serverStats.delivered || 0;
    
    // تحديث شريط التنقل
    if (elements.navTotalOrders) elements.navTotalOrders.textContent = serverStats.total_active || 0;
    if (elements.navConfirmedOrders) elements.navConfirmedOrders.textContent = serverStats.confirmed || 0;
    if (elements.navPreparingOrders) elements.navPreparingOrders.textContent = preparingTotal;
    if (elements.navDeliveredOrders) elements.navDeliveredOrders.textContent = serverStats.delivered || 0;
    
    // يمكن إضافة المزيد من الإحصائيات هنا إذا لزم الأمر
}

// تحديث عدادات التابات
function updateTabCounts(orders, serverStats = null) {
    let counts;
    
    if (serverStats) {
        // استخدام الإحصائيات من الخادم
        counts = {
            all: serverStats.total_active || 0,
            pending_confirmation: serverStats.pending_confirmation || 0,
            confirmed: serverStats.confirmed || 0,
            preparing: serverStats.preparing || 0,
            out_for_delivery: serverStats.out_for_delivery || 0,
            delivered: serverStats.delivered || 0
        };
        console.log('استخدام إحصائيات الخادم للتابات:', counts);
    } else {
        // حساب الإحصائيات محلياً
        counts = {
            all: orders.length,
            pending_confirmation: orders.filter(o => o.status?.toLowerCase() === 'pending_confirmation').length,
            confirmed: orders.filter(o => o.status?.toLowerCase() === 'confirmed').length,
            preparing: orders.filter(o => o.status?.toLowerCase() === 'preparing').length,
            out_for_delivery: orders.filter(o => o.status?.toLowerCase() === 'out_for_delivery').length,
            delivered: orders.filter(o => o.status?.toLowerCase() === 'delivered').length
        };
    }
    
    elements.countAll.textContent = counts.all;
    elements.countPending.textContent = counts.pending_confirmation;
    elements.countConfirmed.textContent = counts.confirmed;
    elements.countPreparing.textContent = counts.preparing;
    elements.countDelivery.textContent = counts.out_for_delivery;
    elements.countDelivered.textContent = counts.delivered;
}

// تبديل التاب
function switchTab(status) {
    // تحديث التاب النشط
    activeTab = status;
    
    // تحديث أزرار التابات
    elements.tabButtons.forEach(button => {
        button.classList.remove('active');
        if (button.getAttribute('data-status') === status) {
            button.classList.add('active');
        }
    });
    
    // إظهار/إخفاء المحتوى المناسب
    const ordersContainer = document.getElementById('ordersContainer');
    const reportsContent = document.getElementById('reportsContent');
    
    if (status === 'reports') {
        // إظهار التقارير وإخفاء الطلبات
        if (ordersContainer) ordersContainer.style.display = 'none';
        if (reportsContent) reportsContent.style.display = 'block';
    } else {
        // إظهار الطلبات وإخفاء التقارير
        if (ordersContainer) ordersContainer.style.display = 'grid';
        if (reportsContent) reportsContent.style.display = 'none';
        
        // إعادة عرض الطلبات المفلترة
        filterAndDisplayOrders();
    }
}

// فلترة وعرض الطلبات حسب التاب النشط
function filterAndDisplayOrders() {
    // إذا كان تاب التقارير نشط، لا تفعل شيء
    if (activeTab === 'reports') {
        return;
    }
    
    let ordersToShow = currentOrders;
    
    // تطبيق الفلترة حسب الحالة
    if (activeTab !== 'all') {
        ordersToShow = currentOrders.filter(order => {
            if (!order.status) return false;
            
            const orderStatus = order.status.toLowerCase().trim();
            const tabStatus = activeTab.toLowerCase().trim();
            
            return orderStatus === tabStatus;
        });
    }
    
    // عرض الطلبات
    elements.ordersContainer.innerHTML = '';
    
    if (ordersToShow.length === 0) {
        elements.ordersContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #7f8c8d;">
                <h3>لا توجد طلبات في هذه الفئة</h3>
                <p>جميع الطلبات في حالة أخرى</p>
                <small style="display: block; margin-top: 10px; opacity: 0.7;">
                    البحث عن: "${activeTab}"
                </small>
            </div>
        `;
        return;
    }
    
    elements.ordersContainer.style.display = 'grid';
    ordersToShow.forEach((order, index) => {
        const orderCard = createOrderCard(order, index);
        elements.ordersContainer.appendChild(orderCard);
    });
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
    elements.tabsContainer.style.display = 'none';
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
        'pending_confirmation': 'في انتظار التأكيد',
        'confirmed': 'مؤكد',
        'preparing': 'قيد التحضير',
        'out_for_delivery': 'في الطريق للتسليم',
        'delivered': 'تم التسليم',
        'canceled': 'ملغي'
    };
    
    return statusMap[status?.toLowerCase()] || status || 'غير معروف';
}

// تنظيف الذاكرة عند إغلاق الصفحة
window.addEventListener('beforeunload', function() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }
});

// تنظيف أي cache قديم
function clearOldCache() {
    // إصدار التطبيق الحالي
    const currentVersion = '2.0.0';
    const storedVersion = localStorage.getItem('appVersion');
    
    if (storedVersion !== currentVersion) {
        console.log('إزالة cache قديم وتحديث الإصدار');
        
        // إزالة أي بيانات cache قديمة
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('orderCache') || key.startsWith('statusCache')) {
                localStorage.removeItem(key);
            }
        });
        
        // تحديث رقم الإصدار
        localStorage.setItem('appVersion', currentVersion);
    }
}

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

// ============================================
// وظائف التقارير والإحصائيات
// ============================================

// تحديث التقارير بناءً على البيانات المتاحة
function updateReports(orders) {
    if (!orders || orders.length === 0) {
        // إذا لم تكن هناك بيانات، عرض أصفار
        resetReports();
        return;
    }
    
    // تحديث الشهر الحالي
    const currentMonth = new Date().toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
    const monthElement = document.getElementById('currentMonth');
    if (monthElement) {
        monthElement.textContent = currentMonth;
    }
    
    // حساب التقارير
    const reports = calculateReports(orders);
    
    // تحديث واجهة المستخدم
    updateReportUI(reports);
}

// حساب جميع التقارير
function calculateReports(orders) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // فلترة الطلبات حسب الفترة
    const todayOrders = orders.filter(o => isOrderInDate(o, today));
    const yesterdayOrders = orders.filter(o => isOrderInDate(o, yesterday));
    const weekOrders = orders.filter(o => isOrderAfterDate(o, weekStart));
    const monthOrders = orders.filter(o => isOrderAfterDate(o, monthStart));
    
    // حساب المبيعات
    const todaySales = calculateTotalSales(todayOrders);
    const yesterdaySales = calculateTotalSales(yesterdayOrders);
    const weekSales = calculateTotalSales(weekOrders);
    const monthSales = calculateTotalSales(monthOrders);
    const totalSales = calculateTotalSales(orders);
    
    // حساب عدد الطلبات
    const todayOrdersCount = todayOrders.length;
    const yesterdayOrdersCount = yesterdayOrders.length;
    const weekOrdersCount = weekOrders.length;
    const monthOrdersCount = monthOrders.length;
    const totalOrdersCount = orders.length;
    
    // حساب متوسط قيمة الطلب
    const avgOrderValue = totalOrdersCount > 0 ? totalSales / totalOrdersCount : 0;
    
    // حساب معدل النجاح
    const deliveredOrders = orders.filter(o => o.status?.toLowerCase() === 'delivered');
    const completedOrders = orders.filter(o => 
        ['delivered', 'canceled'].includes(o.status?.toLowerCase())
    );
    const successRate = completedOrders.length > 0 
        ? (deliveredOrders.length / completedOrders.length) * 100 
        : 0;
    
    // حساب متوسط وقت التحضير (بالدقائق)
    const avgPrepTime = calculateAveragePrepTime(deliveredOrders);
    
    return {
        // المبيعات
        todaySales,
        yesterdaySales,
        weekSales,
        monthSales,
        totalSales,
        // عدد الطلبات
        todayOrdersCount,
        yesterdayOrdersCount,
        weekOrdersCount,
        monthOrdersCount,
        totalOrdersCount,
        // إحصائيات أخرى
        avgOrderValue,
        successRate,
        avgPrepTime
    };
}

// تحديث واجهة المستخدم بالتقارير
function updateReportUI(reports) {
    // التقارير الرئيسية
    safeUpdateElement('totalSales', formatPrice(reports.totalSales) + ' جنيه');
    safeUpdateElement('todaySales', formatPrice(reports.todaySales) + ' جنيه');
    safeUpdateElement('totalOrdersCount', reports.totalOrdersCount + ' طلب');
    safeUpdateElement('todayOrdersCount', reports.todayOrdersCount + ' طلب');
    safeUpdateElement('avgOrderValue', formatPrice(reports.avgOrderValue) + ' جنيه');
    safeUpdateElement('successRate', reports.successRate.toFixed(1) + '%');
    safeUpdateElement('avgPrepTime', reports.avgPrepTime > 0 ? reports.avgPrepTime.toFixed(0) + ' دقيقة' : '-- دقيقة');
    safeUpdateElement('monthlyRevenue', formatPrice(reports.monthSales) + ' جنيه');
    
    // تحديث مبيعات اليوم في شريط التنقل
    safeUpdateElement('navTodaySales', formatPrice(reports.todaySales) + ' ج');
    
    // التقارير التفصيلية
    safeUpdateElement('detailTodaySales', formatPrice(reports.todaySales) + ' جنيه');
    safeUpdateElement('detailYesterdaySales', formatPrice(reports.yesterdaySales) + ' جنيه');
    safeUpdateElement('detailWeekSales', formatPrice(reports.weekSales) + ' جنيه');
    safeUpdateElement('detailMonthSales', formatPrice(reports.monthSales) + ' جنيه');
    
    safeUpdateElement('detailTodayOrders', reports.todayOrdersCount);
    safeUpdateElement('detailYesterdayOrders', reports.yesterdayOrdersCount);
    safeUpdateElement('detailWeekOrders', reports.weekOrdersCount);
    safeUpdateElement('detailMonthOrders', reports.monthOrdersCount);
}

// إعادة تعيين التقارير للأصفار
function resetReports() {
    const elements = [
        'totalSales', 'todaySales', 'totalOrdersCount', 'todayOrdersCount',
        'avgOrderValue', 'successRate', 'avgPrepTime', 'monthlyRevenue',
        'detailTodaySales', 'detailYesterdaySales', 'detailWeekSales', 'detailMonthSales',
        'detailTodayOrders', 'detailYesterdayOrders', 'detailWeekOrders', 'detailMonthOrders'
    ];
    
    elements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            if (id.includes('Sales') || id.includes('Value') || id.includes('Revenue')) {
                element.textContent = '0 جنيه';
            } else if (id.includes('Orders') || id.includes('Count')) {
                element.textContent = '0';
            } else if (id.includes('Rate')) {
                element.textContent = '0%';
            } else if (id.includes('Time')) {
                element.textContent = '-- دقيقة';
            }
        }
    });
}

// حساب إجمالي المبيعات
function calculateTotalSales(orders) {
    return orders.reduce((total, order) => {
        const price = parseFloat(order.total_price) || 0;
        return total + price;
    }, 0);
}

// التحقق من أن الطلب في تاريخ محدد
function isOrderInDate(order, targetDate) {
    if (!order.order_time_cairo) return false;
    
    try {
        const orderDate = new Date(order.order_time_cairo);
        return orderDate.getFullYear() === targetDate.getFullYear() &&
               orderDate.getMonth() === targetDate.getMonth() &&
               orderDate.getDate() === targetDate.getDate();
    } catch (error) {
        return false;
    }
}

// التحقق من أن الطلب بعد تاريخ محدد
function isOrderAfterDate(order, targetDate) {
    if (!order.order_time_cairo) return false;
    
    try {
        const orderDate = new Date(order.order_time_cairo);
        return orderDate >= targetDate;
    } catch (error) {
        return false;
    }
}

// حساب متوسط وقت التحضير
function calculateAveragePrepTime(deliveredOrders) {
    if (deliveredOrders.length === 0) return 0;
    
    let totalMinutes = 0;
    let validOrders = 0;
    
    deliveredOrders.forEach(order => {
        if (order.order_time_cairo && order.delivery_time) {
            try {
                const orderTime = new Date(order.order_time_cairo);
                const deliveryTime = new Date(order.delivery_time);
                const diffMinutes = (deliveryTime - orderTime) / (1000 * 60);
                
                if (diffMinutes > 0 && diffMinutes < 1440) { // أقل من 24 ساعة
                    totalMinutes += diffMinutes;
                    validOrders++;
                }
            } catch (error) {
                // تجاهل الطلبات ذات التواريخ غير الصحيحة
            }
        }
    });
    
    return validOrders > 0 ? totalMinutes / validOrders : 0;
}

// تحديث عنصر بأمان
function safeUpdateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}