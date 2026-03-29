/**
 * Функция для расчета выручки
 * @param {Object} purchase - запись о покупке (item из чека)
 * @param {Object} product - карточка товара
 * @returns {number} выручка за данную позицию
 */
function calculateSimpleRevenue(purchase, product) {
    const quantity = Number(purchase.quantity ?? 1);
    const salePrice = Number(purchase.sale_price ?? product.sale_price ?? 0);

    return quantity * salePrice;
}

/**
 * Функция для расчета бонусов по позиции в рейтинге
 * @param {number} index - порядковый номер в отсортированном массиве
 * @param {number} total - общее число продавцов
 * @param {Object} seller - карточка продавца с метриками
 * @returns {number} сумма бонуса
 */
function calculateBonusByProfit(index, total, seller) {
    if (!seller || total <= 0) {
        return 0;
    }

    const profit = Number(seller.profit ?? 0);

    if (profit <= 0) {
        return 0;
    }

    if (index === 0) {
        return Math.round(profit * 0.15 * 100) / 100;
    }

    if (index === total - 1) {
        return Math.round(profit * 0.05 * 100) / 100;
    }

    return Math.round(profit * 0.10 * 100) / 100;
}

/**
 * Возвращает полное имя продавца
 * @param {Object} seller - объект продавца
 * @returns {string} имя и фамилия
 */
function getSellerName(seller) {
    return `${seller.first_name} ${seller.last_name}`;
}

/**
 * Стандартный коллектор метрик для каждой продажи.
 * Собирает промежуточные данные, необходимые для бонусных функций.
 * @param {Object} context - контекст продажи
 * @param {Object} context.item - позиция из чека
 * @param {Object} context.product - карточка товара
 * @param {Object} context.receipt - весь чек
 * @param {number} context.quantity - количество
 * @param {number} context.revenue - выручка
 * @param {number} context.cost - себестоимость
 * @param {number} context.profit - прибыль
 * @param {Object} metrics - накопленные метрики продавца (мутируется)
 */
function defaultMetricsCollector(context, metrics) {
    var item = context.item;
    var product = context.product;
    var receipt = context.receipt;
    var quantity = context.quantity;
    var revenue = context.revenue;
    var profit = context.profit;

    if (!metrics.customers) {
        metrics.customers = {};
    }
    if (!metrics.receipts) {
        metrics.receipts = [];
    }
    if (!metrics.monthly_profit) {
        metrics.monthly_profit = {};
    }
    if (!metrics.product_stats) {
        metrics.product_stats = {};
    }

    // Покупатели продавца
    var customerId = receipt.customer_id;
    if (!metrics.customers[customerId]) {
        metrics.customers[customerId] = {
            total_spent: 0,
            visits: new Set(),
            max_receipt: 0
        };
    }
    metrics.customers[customerId].total_spent += revenue;
    metrics.customers[customerId].visits.add(receipt.receipt_id);

    // Максимальный чек покупателя
    var receiptTotal = Number(receipt.total_amount ?? 0);
    if (receiptTotal > metrics.customers[customerId].max_receipt) {
        metrics.customers[customerId].max_receipt = receiptTotal;
    }

    // Помесячная прибыль
    var month = receipt.date.substring(0, 7);
    metrics.monthly_profit[month] = (metrics.monthly_profit[month] || 0) + profit;

    // Статистика по товарам
    var productName = product.name;
    metrics.product_stats[productName] = (metrics.product_stats[productName] || 0) + quantity;
}

/**
 * Анализирует данные продаж, строит рейтинг продавцов.
 * Принимает внешние функции для расчёта выручки, бонусов и сбора метрик,
 * что делает её переиспользуемой с любой логикой.
 *
 * @param {Object} data - данные (sellers, products, purchase_records)
 * @param {Object} options - настройки
 * @param {Function} options.calculateRevenue - функция расчёта выручки
 * @param {Function} options.calculateBonus - функция расчёта бонуса по позиции
 * @param {Function} [options.collectMetrics] - функция сбора промежуточных метрик
 * @returns {{seller_id: string, name: string, sales_count: number, revenue: number, profit: number, bonus: number, top_products: string[], metrics: Object}[]}
 */
function analyzeSalesData(data, options) {
    if (!data || typeof data !== "object") {
        return [];
    }

    if (!options || typeof options !== "object") {
        return [];
    }

    var calculateRevenue = options.calculateRevenue;
    var calculateBonus = options.calculateBonus;
    var collectMetrics = options.collectMetrics || null;

    if (typeof calculateRevenue !== "function" || typeof calculateBonus !== "function") {
        return [];
    }

    var sellers = Array.isArray(data.sellers) ? data.sellers : [];
    var products = Array.isArray(data.products) ? data.products : [];
    var purchaseRecords = Array.isArray(data.purchase_records) ? data.purchase_records : [];

    // Хеш-таблица товаров по SKU для быстрого поиска O(1)
    var productsBySku = products.reduce(function (acc, product) {
        acc[product.sku] = product;
        return acc;
    }, {});

    // Инициализация статистики для каждого продавца
    var sellerStats = sellers.reduce(function (acc, seller) {
        acc[seller.id] = {
            seller_id: seller.id,
            name: getSellerName(seller),
            sales_count: 0,
            revenue: 0,
            profit: 0,
            bonus: 0,
            top_products: [],
            metrics: {}
        };
        return acc;
    }, {});

    // Обработка всех чеков
    purchaseRecords.forEach(function (receipt) {
        var sellerId = receipt.seller_id;
        var seller = sellerStats[sellerId];

        if (!seller || !Array.isArray(receipt.items)) {
            return;
        }

        receipt.items.forEach(function (item) {
            var product = productsBySku[item.sku];

            if (!product) {
                return;
            }

            var quantity = Number(item.quantity ?? 1);
            var revenue = Number(calculateRevenue(item, product)) || 0;
            var cost = quantity * Number(product.purchase_price ?? 0);
            var profit = revenue - cost;

            seller.sales_count += quantity;
            seller.revenue += revenue;
            seller.profit += profit;

            // Сбор метрик через переданную функцию
            if (typeof collectMetrics === "function") {
                collectMetrics(
                    {
                        item: item,
                        product: product,
                        receipt: receipt,
                        quantity: quantity,
                        revenue: revenue,
                        cost: cost,
                        profit: profit
                    },
                    seller.metrics
                );
            }
        });
    });

    // Сортировка: по прибыли (убыв.), по выручке (убыв.), по имени (алфавит)
    var rankedSellers = Object.values(sellerStats).sort(function (a, b) {
        if (b.profit !== a.profit) {
            return b.profit - a.profit;
        }
        if (b.revenue !== a.revenue) {
            return b.revenue - a.revenue;
        }
        return a.name.localeCompare(b.name, "ru");
    });

    // Финальная обработка: бонусы, округление, топ товаров
    rankedSellers.forEach(function (seller, index) {
        seller.bonus = calculateBonus(index, rankedSellers.length, seller);
        seller.revenue = Math.round(seller.revenue * 100) / 100;
        seller.profit = Math.round(seller.profit * 100) / 100;

        var productStats = (seller.metrics && seller.metrics.product_stats) || {};

        seller.top_products = Object.entries(productStats)
            .sort(function (a, b) {
                if (b[1] !== a[1]) {
                    return b[1] - a[1];
                }
                return a[0].localeCompare(b[0], "ru");
            })
            .slice(0, 3)
            .map(function (entry) {
                return entry[0];
            });
    });

    return rankedSellers;
}

/**
 * Рассчитывает специальные бонусы по массиву бонусных функций.
 * Каждая функция получает обработанные данные и возвращает результат.
 *
 * @param {Object[]} processedData - обработанные данные из analyzeSalesData
 * @param {Function[]} bonusFunctions - массив функций для расчёта бонусов
 * @returns {Object[]} массив результатов бонусов
 */
function calculateBonuses(processedData, bonusFunctions) {
    if (!Array.isArray(processedData) || !Array.isArray(bonusFunctions)) {
        return [];
    }

    return bonusFunctions
        .map(function (bonusFunc) {
            if (typeof bonusFunc !== "function") {
                return null;
            }
            return bonusFunc(processedData);
        })
        .filter(Boolean);
}

/**
 * Бонус: Продавец, привлекший лучшего покупателя
 * (покупатель с наибольшей суммой покупок у данного продавца)
 *
 * @param {Object[]} sellersData - обработанные данные продавцов
 * @returns {Object} результат: title, seller_name, seller_id, details
 */
function bonusBestCustomerAttractor(sellersData) {
    var bestSeller = null;
    var bestCustomerSpent = 0;
    var bestCustomerId = null;

    sellersData.forEach(function (seller) {
        var customers = (seller.metrics && seller.metrics.customers) || {};

        Object.entries(customers).forEach(function (entry) {
            var customerId = entry[0];
            var stats = entry[1];

            if (stats.total_spent > bestCustomerSpent) {
                bestCustomerSpent = stats.total_spent;
                bestSeller = seller;
                bestCustomerId = customerId;
            }
        });
    });

    return {
        title: "Привлёк лучшего покупателя",
        seller_name: bestSeller ? bestSeller.name : "—",
        seller_id: bestSeller ? bestSeller.seller_id : null,
        details: "Покупатель " + bestCustomerId +
                 " потратил " + Math.round(bestCustomerSpent * 100) / 100
    };
}

/**
 * Бонус: Продавец, лучше всего удерживающий покупателя
 * (наибольшее среднее количество уникальных визитов покупателей)
 *
 * @param {Object[]} sellersData - обработанные данные продавцов
 * @returns {Object} результат: title, seller_name, seller_id, details
 */
function bonusBestCustomerRetention(sellersData) {
    var bestSeller = null;
    var bestAvgVisits = 0;

    sellersData.forEach(function (seller) {
        var customers = (seller.metrics && seller.metrics.customers) || {};
        var customerEntries = Object.values(customers);

        if (customerEntries.length === 0) {
            return;
        }

        var totalVisits = customerEntries.reduce(function (sum, c) {
            return sum + (c.visits instanceof Set ? c.visits.size : c.visits);
        }, 0);

        var avgVisits = totalVisits / customerEntries.length;

        if (avgVisits > bestAvgVisits) {
            bestAvgVisits = avgVisits;
            bestSeller = seller;
        }
    });

    return {
        title: "Лучше всего удерживает покупателя",
        seller_name: bestSeller ? bestSeller.name : "—",
        seller_id: bestSeller ? bestSeller.seller_id : null,
        details: "Среднее визитов на покупателя: " +
                 Math.round(bestAvgVisits * 100) / 100
    };
}

/**
 * Бонус: Продавец, привлекший клиента с наибольшим чеком
 *
 * @param {Object[]} sellersData - обработанные данные продавцов
 * @returns {Object} результат: title, seller_name, seller_id, details
 */
function bonusLargestReceiptCustomer(sellersData) {
    var bestSeller = null;
    var maxReceipt = 0;
    var maxReceiptCustomer = null;

    sellersData.forEach(function (seller) {
        var customers = (seller.metrics && seller.metrics.customers) || {};

        Object.entries(customers).forEach(function (entry) {
            var customerId = entry[0];
            var stats = entry[1];

            if (stats.max_receipt > maxReceipt) {
                maxReceipt = stats.max_receipt;
                bestSeller = seller;
                maxReceiptCustomer = customerId;
            }
        });
    });

    return {
        title: "Привлёк клиента с наибольшим чеком",
        seller_name: bestSeller ? bestSeller.name : "—",
        seller_id: bestSeller ? bestSeller.seller_id : null,
        details: "Покупатель " + maxReceiptCustomer +
                 ", чек: " + Math.round(maxReceipt * 100) / 100
    };
}

/**
 * Бонус: Продавец с наибольшей средней прибылью на единицу товара
 *
 * @param {Object[]} sellersData - обработанные данные продавцов
 * @returns {Object} результат: title, seller_name, seller_id, details
 */
function bonusHighestAvgProfit(sellersData) {
    var bestSeller = null;
    var bestAvgProfit = -Infinity;

    sellersData.forEach(function (seller) {
        if (seller.sales_count === 0) {
            return;
        }

        var avgProfit = seller.profit / seller.sales_count;

        if (avgProfit > bestAvgProfit) {
            bestAvgProfit = avgProfit;
            bestSeller = seller;
        }
    });

    return {
        title: "Наибольшая средняя прибыль",
        seller_name: bestSeller ? bestSeller.name : "—",
        seller_id: bestSeller ? bestSeller.seller_id : null,
        details: "Средняя прибыль на товар: " +
                 Math.round(bestAvgProfit * 100) / 100
    };
}

/**
 * Бонус: Продавец со стабильно растущей средней прибылью
 * (наибольшее число последовательных месяцев роста помесячной прибыли)
 *
 * @param {Object[]} sellersData - обработанные данные продавцов
 * @returns {Object} результат: title, seller_name, seller_id, details
 */
function bonusConsistentGrowth(sellersData) {
    var bestSeller = null;
    var bestStreak = 0;

    sellersData.forEach(function (seller) {
        var monthlyProfit = (seller.metrics && seller.metrics.monthly_profit) || {};
        var months = Object.keys(monthlyProfit).sort();

        if (months.length < 2) {
            return;
        }

        var currentStreak = 0;
        var maxStreak = 0;

        for (var i = 1; i < months.length; i++) {
            var prevProfit = monthlyProfit[months[i - 1]];
            var currProfit = monthlyProfit[months[i]];

            if (currProfit > prevProfit) {
                currentStreak++;
                if (currentStreak > maxStreak) {
                    maxStreak = currentStreak;
                }
            } else {
                currentStreak = 0;
            }
        }

        if (maxStreak > bestStreak) {
            bestStreak = maxStreak;
            bestSeller = seller;
        }
    });

    return {
        title: "Стабильно растущая средняя прибыль",
        seller_name: bestSeller ? bestSeller.name : "—",
        seller_id: bestSeller ? bestSeller.seller_id : null,
        details: "Месяцев непрерывного роста: " + bestStreak
    };
}