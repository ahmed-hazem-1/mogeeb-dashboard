// إعدادات التطبيق
const getStoredConfig = () => {
    const storedConfig = localStorage.getItem('mogeebConfig');
    return storedConfig ? JSON.parse(storedConfig) : null;
};

const CONFIG = getStoredConfig() || {
    GET_ORDERS_WEBHOOK: 'https://biometrical-bettina-benignly.ngrok-free.dev/webhook/webhook/get-orders',
    AUTO_REFRESH_INTERVAL: 60000, // 1 minute for reports
    MAX_RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 2000
};

// متغيرات عامة
let allOrdersHistory = [];
let currentReportPeriod = 'today';
let autoRefreshTimer = null;

// عناصر DOM
const elements = {
    loadingContainer: document.getElementById('loadingContainer'),
    reportsSection: document.getElementById('reportsSection'),
    lastUpdate: document.getElementById('lastUpdate'),
    connectionStatus: document.getElementById('connectionStatus'),
    refreshBtn: document.getElementById('refreshBtn'),
    navTotalOrders: document.getElementById('navTotalOrders'),
    navConfirmedOrders: document.getElementById('navConfirmedOrders'),
    navPreparingOrders: document.getElementById('navPreparingOrders'),
    navDeliveredOrders: document.getElementById('navDeliveredOrders'),
    navTodaySales: document.getElementById('navTodaySales')
};

// تهيئة التطبيق
document.addEventListener('DOMContentLoaded', function() {
    console.log('تم تحميل صفحة التقارير');
    initializeReportsPage();
});

function initializeReportsPage() {
    setupEventListeners();
    setupReportEventListeners();
    loadReportsData();
    startAutoRefresh();
}

// إعداد مستمعي الأحداث
function setupEventListeners() {
    if (elements.refreshBtn) {
        elements.refreshBtn.addEventListener('click', () => {
            console.log('تحديث التقارير يدوياً');
            loadReportsData();
        });
    }
}

// إعداد مستمعي أحداث التقارير
function setupReportEventListeners() {
    const periodButtons = document.querySelectorAll('.period-btn');
    periodButtons.forEach(button => {
        button.addEventListener('click', () => {
            periodButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentReportPeriod = button.getAttribute('data-period');
            updateReports(allOrdersHistory);
        });
    });
}

// تحميل بيانات التقارير
async function loadReportsData() {
    console.log('جاري تحميل بيانات التقارير...');
    showLoading();
    
    try {
        const response = await fetch(CONFIG.GET_ORDERS_WEBHOOK, {
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
        
        // عرض التقارير
        showReports();
        
        console.log('تم تحميل التقارير بنجاح');
        
    } catch (error) {
        console.error('خطأ في تحميل التقارير:', error);
        updateConnectionStatus('منقطع', false);
    }
}

// معالجة بيانات الطلبات
function processOrdersData(data) {
    let orders = [];
    let stats = null;
    
    if (Array.isArray(data) && data.length > 0 && data[0].orders) {
        orders = data[0].orders || [];
        stats = data[0].stats || null;
    } else if (Array.isArray(data)) {
        orders = data;
    } else if (data && data.orders) {
        orders = data.orders;
        stats = data.stats;
    }
    
    // فلترة الطلبات (استبعاد الملغاة فقط)
    orders = orders.filter(order => 
        order.status && !['canceled'].includes(order.status.toLowerCase())
    );
    
    console.log(`تم العثور على ${orders.length} طلب`);
    
    // حفظ البيانات
    allOrdersHistory = orders;
    
    // تحديث الإحصائيات
    updateQuickStats(orders, stats);
    
    // تحديث التقارير
    updateReports(orders);
    
    // تحديث وقت آخر تحديث
    updateLastUpdateTime();
    
    return orders;
}

// تحديث الإحصائيات السريعة
function updateQuickStats(orders, serverStats) {
    if (serverStats) {
        if (elements.navTotalOrders) elements.navTotalOrders.textContent = serverStats.total_active || 0;
        if (elements.navConfirmedOrders) elements.navConfirmedOrders.textContent = serverStats.confirmed || 0;
        const preparingTotal = (serverStats.preparing || 0) + (serverStats.out_for_delivery || 0);
        if (elements.navPreparingOrders) elements.navPreparingOrders.textContent = preparingTotal;
        if (elements.navDeliveredOrders) elements.navDeliveredOrders.textContent = serverStats.delivered || 0;
    } else {
        const stats = {
            total: orders.length,
            confirmed: orders.filter(o => o.status?.toLowerCase() === 'confirmed').length,
            preparing: orders.filter(o => ['preparing', 'out_for_delivery'].includes(o.status?.toLowerCase())).length,
            delivered: orders.filter(o => o.status?.toLowerCase() === 'delivered').length
        };
        
        if (elements.navTotalOrders) elements.navTotalOrders.textContent = stats.total;
        if (elements.navConfirmedOrders) elements.navConfirmedOrders.textContent = stats.confirmed;
        if (elements.navPreparingOrders) elements.navPreparingOrders.textContent = stats.preparing;
        if (elements.navDeliveredOrders) elements.navDeliveredOrders.textContent = stats.delivered;
    }
}

// تحديث التقارير
function updateReports(orders) {
    if (!orders || orders.length === 0) {
        resetReports();
        return;
    }
    
    const currentMonth = new Date().toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
    safeUpdateElement('currentMonth', currentMonth);
    
    const reports = calculateReports(orders);
    updateReportUI(reports);
}

// حساب التقارير
function calculateReports(orders) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const todayOrders = orders.filter(o => isOrderInDate(o, today));
    const yesterdayOrders = orders.filter(o => isOrderInDate(o, yesterday));
    const weekOrders = orders.filter(o => isOrderAfterDate(o, weekStart));
    const monthOrders = orders.filter(o => isOrderAfterDate(o, monthStart));
    
    const todaySales = calculateTotalSales(todayOrders);
    const yesterdaySales = calculateTotalSales(yesterdayOrders);
    const weekSales = calculateTotalSales(weekOrders);
    const monthSales = calculateTotalSales(monthOrders);
    const totalSales = calculateTotalSales(orders);
    
    const todayOrdersCount = todayOrders.length;
    const yesterdayOrdersCount = yesterdayOrders.length;
    const weekOrdersCount = weekOrders.length;
    const monthOrdersCount = monthOrders.length;
    const totalOrdersCount = orders.length;
    
    const avgOrderValue = totalOrdersCount > 0 ? totalSales / totalOrdersCount : 0;
    
    const deliveredOrders = orders.filter(o => o.status?.toLowerCase() === 'delivered');
    const completedOrders = orders.filter(o => 
        ['delivered', 'canceled'].includes(o.status?.toLowerCase())
    );
    const successRate = completedOrders.length > 0 
        ? (deliveredOrders.length / completedOrders.length) * 100 
        : 0;
    
    const avgPrepTime = calculateAveragePrepTime(deliveredOrders);
    
    return {
        todaySales, yesterdaySales, weekSales, monthSales, totalSales,
        todayOrdersCount, yesterdayOrdersCount, weekOrdersCount, monthOrdersCount, totalOrdersCount,
        avgOrderValue, successRate, avgPrepTime
    };
}

// تحديث واجهة التقارير
function updateReportUI(reports) {
    safeUpdateElement('totalSales', formatPrice(reports.totalSales) + ' جنيه');
    safeUpdateElement('todaySales', formatPrice(reports.todaySales) + ' جنيه');
    safeUpdateElement('totalOrdersCount', reports.totalOrdersCount + ' طلب');
    safeUpdateElement('todayOrdersCount', reports.todayOrdersCount + ' طلب');
    safeUpdateElement('avgOrderValue', formatPrice(reports.avgOrderValue) + ' جنيه');
    safeUpdateElement('successRate', reports.successRate.toFixed(1) + '%');
    safeUpdateElement('avgPrepTime', reports.avgPrepTime > 0 ? reports.avgPrepTime.toFixed(0) + ' دقيقة' : '-- دقيقة');
    safeUpdateElement('monthlyRevenue', formatPrice(reports.monthSales) + ' جنيه');
    safeUpdateElement('navTodaySales', formatPrice(reports.todaySales) + ' ج');
    
    safeUpdateElement('detailTodaySales', formatPrice(reports.todaySales) + ' جنيه');
    safeUpdateElement('detailYesterdaySales', formatPrice(reports.yesterdaySales) + ' جنيه');
    safeUpdateElement('detailWeekSales', formatPrice(reports.weekSales) + ' جنيه');
    safeUpdateElement('detailMonthSales', formatPrice(reports.monthSales) + ' جنيه');
    
    safeUpdateElement('detailTodayOrders', reports.todayOrdersCount);
    safeUpdateElement('detailYesterdayOrders', reports.yesterdayOrdersCount);
    safeUpdateElement('detailWeekOrders', reports.weekOrdersCount);
    safeUpdateElement('detailMonthOrders', reports.monthOrdersCount);
}

// دوال مساعدة
function calculateTotalSales(orders) {
    return orders.reduce((total, order) => {
        const price = parseFloat(order.total_price) || 0;
        return total + price;
    }, 0);
}

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

function isOrderAfterDate(order, targetDate) {
    if (!order.order_time_cairo) return false;
    try {
        const orderDate = new Date(order.order_time_cairo);
        return orderDate >= targetDate;
    } catch (error) {
        return false;
    }
}

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
                
                if (diffMinutes > 0 && diffMinutes < 1440) {
                    totalMinutes += diffMinutes;
                    validOrders++;
                }
            } catch (error) {}
        }
    });
    
    return validOrders > 0 ? totalMinutes / validOrders : 0;
}

function formatPrice(price) {
    if (price === null || price === undefined || price === '' || isNaN(price)) return '0';
    const numPrice = parseFloat(price);
    if (isNaN(numPrice)) return '0';
    return numPrice.toLocaleString('ar-EG', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function safeUpdateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

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

function showLoading() {
    if (elements.loadingContainer) elements.loadingContainer.style.display = 'flex';
    if (elements.reportsSection) elements.reportsSection.style.display = 'none';
}

function showReports() {
    if (elements.loadingContainer) elements.loadingContainer.style.display = 'none';
    if (elements.reportsSection) elements.reportsSection.style.display = 'block';
}

function updateConnectionStatus(statusText, isConnected) {
    const statusElement = elements.connectionStatus?.querySelector('.status-text');
    const dotElement = elements.connectionStatus?.querySelector('.status-dot');
    
    if (statusElement) statusElement.textContent = statusText;
    if (dotElement) {
        if (isConnected) {
            dotElement.classList.remove('disconnected');
        } else {
            dotElement.classList.add('disconnected');
        }
    }
}

function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ar-EG');
    if (elements.lastUpdate) {
        elements.lastUpdate.textContent = timeString;
    }
}

function startAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }
    
    autoRefreshTimer = setInterval(() => {
        console.log('تحديث تلقائي للتقارير...');
        loadReportsData();
    }, CONFIG.AUTO_REFRESH_INTERVAL);
}

// تنظيف عند إغلاق الصفحة
window.addEventListener('beforeunload', function() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }
});
