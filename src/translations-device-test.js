export const DEVICE_TEST_TRANSLATIONS = {
	en: {
		SIMULATION_MODE_FLAG: "Server simulation (experimental)",
		SIMULATION_MODE_HELP:
			"Off by default: calculations run in your browser. Saved for future page loads; the current game keeps its mode. Server mode requires a compatible server and a connection throughout play.",
		SIMULATION_MODE_CURRENT: "This tab: {mode}",
		SIMULATION_MODE_OPEN: "Open a new game: {mode} ↗",
		SIMULATION_MODE_BROWSER: "Browser",
		SIMULATION_MODE_SERVER: "Server",
		DEVICE_TEST_TITLE: "Performance test",
		DEVICE_TEST_FLAG: "Performance testing",
		DEVICE_TEST_FLAG_HELP:
			"Show optional browser/server tests. Saved on this browser; normal games are unchanged.",
		DEVICE_TEST_INTRO:
			"Compare this device in browser and server modes. Each test opens in a separate tab and leaves your current game intact.",
		DEVICE_TEST_WORKLOAD:
			"World 2026 · Russia versus China · 120 formations per side · 1× · 3-second warm-up + 20-second measurement. Initial loading can take longer.",
		DEVICE_TEST_HELP:
			"Pause or close other games first. Run one test at a time, keep this tab visible, and do not resize the window. Repeat both modes for a reliable comparison.",
		DEVICE_TEST_BROWSER: "Browser",
		DEVICE_TEST_SERVER: "Server",
		DEVICE_TEST_OPEN_BROWSER: "Open browser test ↗",
		DEVICE_TEST_OPEN_SERVER: "Open server test ↗",
		DEVICE_TEST_START: "Start test",
		DEVICE_TEST_CLOSE: "Close",
		DEVICE_TEST_CANCEL: "Cancel test",
		DEVICE_TEST_DOWNLOAD: "Download JSON report",
		DEVICE_TEST_LOADING: "Loading the test map…",
		DEVICE_TEST_RUNNING: "Testing… {seconds} s elapsed",
		DEVICE_TEST_READY: "Ready to test: {mode}",
		DEVICE_TEST_COMPLETE: "Test complete. The test game is stopped.",
		DEVICE_TEST_INVALID: "Test invalid: {reason}",
		DEVICE_TEST_REASON_hidden: "the tab was hidden",
		DEVICE_TEST_REASON_resized: "the viewport or display scale changed",
		DEVICE_TEST_REASON_cancelled: "cancelled",
		DEVICE_TEST_REASON_timeout: "the test timed out",
		DEVICE_TEST_REASON_failed: "the test could not finish",
		DEVICE_TEST_REASON_no_ticks: "no simulation steps were measured",
		DEVICE_TEST_REASON_disconnected: "the simulation disconnected",
		DEVICE_TEST_REASON_settings: "test settings changed",
		DEVICE_TEST_REASON_disabled: "performance testing is disabled",
		DEVICE_TEST_REASON_not_fresh: "open a fresh test tab before running again",
		DEVICE_TEST_REASON_unavailable:
			"this address does not provide server simulation",
		DEVICE_TEST_DISABLED:
			"Performance testing is disabled. Enable it in Settings → Advanced.",
		DEVICE_TEST_COMPARE: "Latest results on this browser",
		DEVICE_TEST_NO_RESULTS:
			"Run both modes to compare. Reports stay in this browser until you download them.",
		DEVICE_TEST_MISMATCH:
			"These runs are not comparable: versions, settings, devices, or viewport sizes differ, or a run is invalid.",
		DEVICE_TEST_VARIANCE:
			"Same configuration, independent simulations. Random gameplay and background load can still change results.",
		DEVICE_TEST_METRIC: "Measurement",
		DEVICE_TEST_TICK: "Mean simulation step, ms",
		DEVICE_TEST_P95: "P95 simulation step, ms",
		DEVICE_TEST_FRAME: "Mean frame interval, ms",
		DEVICE_TEST_STARTUP: "Owner startup, ms",
		DEVICE_TEST_OWNER: "Actual execution",
		DEVICE_TEST_OWNER_worker: "Browser worker",
		DEVICE_TEST_OWNER_main_thread: "Browser main thread (fallback)",
		DEVICE_TEST_OWNER_server: "Server worker",
		DEVICE_TEST_OWNER_unknown: "Not started",
		DEVICE_TEST_RESULTS_NOTE:
			"Lower times are better. Browser memory values, when available, exclude server RAM and may exclude worker/GPU memory. Raw transport bytes are before compression.",
	},
	uk: {
		SIMULATION_MODE_FLAG: "Серверна симуляція (експериментально)",
		SIMULATION_MODE_HELP:
			"Типово вимкнено: обчислення виконує браузер. Вибір зберігається для наступного відкриття сторінки; поточна гра зберігає свій режим. Серверний режим потребує сумісного сервера та з’єднання протягом гри.",
		SIMULATION_MODE_CURRENT: "Ця вкладка: {mode}",
		SIMULATION_MODE_OPEN: "Відкрити нову гру: {mode} ↗",
		SIMULATION_MODE_BROWSER: "Браузер",
		SIMULATION_MODE_SERVER: "Сервер",
		DEVICE_TEST_TITLE: "Тест продуктивності",
		DEVICE_TEST_FLAG: "Тестування продуктивності",
		DEVICE_TEST_FLAG_HELP:
			"Показувати додаткові тести браузерного й серверного режимів. Зберігається в цьому браузері; звичайна гра не змінюється.",
		DEVICE_TEST_INTRO:
			"Порівняйте цей пристрій у браузерному та серверному режимах. Кожен тест відкривається в окремій вкладці й не змінює поточну гру.",
		DEVICE_TEST_WORKLOAD:
			"Світ 2026 · Росія проти Китаю · по 120 підрозділів · 1× · 3 секунди прогріву + 20 секунд вимірювання. Початкове завантаження може тривати довше.",
		DEVICE_TEST_HELP:
			"Спершу призупиніть або закрийте інші ігри. Запускайте по одному тесту, тримайте вкладку видимою та не змінюйте розмір вікна. Для надійного порівняння повторіть обидва режими.",
		DEVICE_TEST_BROWSER: "Браузер",
		DEVICE_TEST_SERVER: "Сервер",
		DEVICE_TEST_OPEN_BROWSER: "Відкрити браузерний тест ↗",
		DEVICE_TEST_OPEN_SERVER: "Відкрити серверний тест ↗",
		DEVICE_TEST_START: "Почати тест",
		DEVICE_TEST_CLOSE: "Закрити",
		DEVICE_TEST_CANCEL: "Скасувати тест",
		DEVICE_TEST_DOWNLOAD: "Завантажити JSON-звіт",
		DEVICE_TEST_LOADING: "Завантаження тестової мапи…",
		DEVICE_TEST_RUNNING: "Тестування… минуло {seconds} с",
		DEVICE_TEST_READY: "Готово до тесту: {mode}",
		DEVICE_TEST_COMPLETE: "Тест завершено. Тестову гру зупинено.",
		DEVICE_TEST_INVALID: "Тест недійсний: {reason}",
		DEVICE_TEST_REASON_hidden: "вкладку було приховано",
		DEVICE_TEST_REASON_resized: "змінився розмір вікна або масштаб екрана",
		DEVICE_TEST_REASON_cancelled: "скасовано",
		DEVICE_TEST_REASON_timeout: "час очікування тесту вичерпано",
		DEVICE_TEST_REASON_failed: "тест не вдалося завершити",
		DEVICE_TEST_REASON_no_ticks: "не виміряно жодного кроку симуляції",
		DEVICE_TEST_REASON_disconnected: "втрачено зв’язок із симуляцією",
		DEVICE_TEST_REASON_settings: "налаштування тесту змінилися",
		DEVICE_TEST_REASON_disabled: "тестування продуктивності вимкнено",
		DEVICE_TEST_REASON_not_fresh:
			"для нового запуску відкрийте нову тестову вкладку",
		DEVICE_TEST_REASON_unavailable:
			"за цією адресою серверна симуляція недоступна",
		DEVICE_TEST_DISABLED:
			"Тестування продуктивності вимкнено. Увімкніть його в Налаштуваннях → Додатково.",
		DEVICE_TEST_COMPARE: "Останні результати в цьому браузері",
		DEVICE_TEST_NO_RESULTS:
			"Запустіть обидва режими для порівняння. Звіти залишаються в цьому браузері, доки ви їх не завантажите.",
		DEVICE_TEST_MISMATCH:
			"Ці запуски не можна порівнювати: відрізняються версії, налаштування, пристрої чи розміри вікна або один із тестів недійсний.",
		DEVICE_TEST_VARIANCE:
			"Однакові налаштування, незалежні симуляції. Випадковість гри та фонове навантаження все одно впливають на результат.",
		DEVICE_TEST_METRIC: "Показник",
		DEVICE_TEST_TICK: "Середній крок симуляції, мс",
		DEVICE_TEST_P95: "P95 кроку симуляції, мс",
		DEVICE_TEST_FRAME: "Середній інтервал між кадрами, мс",
		DEVICE_TEST_STARTUP: "Запуск обчислень, мс",
		DEVICE_TEST_OWNER: "Фактичне виконання",
		DEVICE_TEST_OWNER_worker: "Worker браузера",
		DEVICE_TEST_OWNER_main_thread: "Головний потік браузера (резервний режим)",
		DEVICE_TEST_OWNER_server: "Worker сервера",
		DEVICE_TEST_OWNER_unknown: "Не запущено",
		DEVICE_TEST_RESULTS_NOTE:
			"Менший час — краще. Пам’ять браузера, якщо доступна, не включає RAM сервера й може не враховувати worker та GPU. Байти транспорту вказані до стиснення.",
	},
	ru: {
		SIMULATION_MODE_FLAG: "Серверная симуляция (экспериментально)",
		SIMULATION_MODE_HELP:
			"По умолчанию выключено: вычисления выполняет браузер. Выбор сохраняется для следующего открытия страницы; текущая игра сохраняет свой режим. Серверному режиму нужны совместимый сервер и соединение на протяжении игры.",
		SIMULATION_MODE_CURRENT: "Эта вкладка: {mode}",
		SIMULATION_MODE_OPEN: "Открыть новую игру: {mode} ↗",
		SIMULATION_MODE_BROWSER: "Браузер",
		SIMULATION_MODE_SERVER: "Сервер",
		DEVICE_TEST_TITLE: "Тест производительности",
		DEVICE_TEST_FLAG: "Тестирование производительности",
		DEVICE_TEST_FLAG_HELP:
			"Показывать дополнительные тесты браузерного и серверного режимов. Сохраняется в этом браузере; обычная игра не меняется.",
		DEVICE_TEST_INTRO:
			"Сравните это устройство в браузерном и серверном режимах. Каждый тест открывается в отдельной вкладке и не меняет текущую игру.",
		DEVICE_TEST_WORKLOAD:
			"Мир 2026 · Россия против Китая · по 120 подразделений · 1× · 3 секунды прогрева + 20 секунд измерений. Первичная загрузка может занять больше времени.",
		DEVICE_TEST_HELP:
			"Сначала приостановите или закройте другие игры. Запускайте по одному тесту, держите вкладку видимой и не меняйте размер окна. Для надёжного сравнения повторите оба режима.",
		DEVICE_TEST_BROWSER: "Браузер",
		DEVICE_TEST_SERVER: "Сервер",
		DEVICE_TEST_OPEN_BROWSER: "Открыть браузерный тест ↗",
		DEVICE_TEST_OPEN_SERVER: "Открыть серверный тест ↗",
		DEVICE_TEST_START: "Начать тест",
		DEVICE_TEST_CLOSE: "Закрыть",
		DEVICE_TEST_CANCEL: "Отменить тест",
		DEVICE_TEST_DOWNLOAD: "Скачать JSON-отчёт",
		DEVICE_TEST_LOADING: "Загрузка тестовой карты…",
		DEVICE_TEST_RUNNING: "Тестирование… прошло {seconds} с",
		DEVICE_TEST_READY: "Готово к тесту: {mode}",
		DEVICE_TEST_COMPLETE: "Тест завершён. Тестовая игра остановлена.",
		DEVICE_TEST_INVALID: "Тест недействителен: {reason}",
		DEVICE_TEST_REASON_hidden: "вкладка была скрыта",
		DEVICE_TEST_REASON_resized: "изменился размер окна или масштаб экрана",
		DEVICE_TEST_REASON_cancelled: "отменено",
		DEVICE_TEST_REASON_timeout: "время ожидания теста истекло",
		DEVICE_TEST_REASON_failed: "не удалось завершить тест",
		DEVICE_TEST_REASON_no_ticks: "не измерено ни одного шага симуляции",
		DEVICE_TEST_REASON_disconnected: "потеряно соединение с симуляцией",
		DEVICE_TEST_REASON_settings: "настройки теста изменились",
		DEVICE_TEST_REASON_disabled: "тестирование производительности отключено",
		DEVICE_TEST_REASON_not_fresh:
			"для нового запуска откройте новую тестовую вкладку",
		DEVICE_TEST_REASON_unavailable:
			"по этому адресу серверная симуляция недоступна",
		DEVICE_TEST_DISABLED:
			"Тестирование производительности отключено. Включите его в Настройках → Дополнительно.",
		DEVICE_TEST_COMPARE: "Последние результаты в этом браузере",
		DEVICE_TEST_NO_RESULTS:
			"Запустите оба режима для сравнения. Отчёты остаются в этом браузере, пока вы их не скачаете.",
		DEVICE_TEST_MISMATCH:
			"Эти запуски нельзя сравнивать: отличаются версии, настройки, устройства или размеры окна либо один из тестов недействителен.",
		DEVICE_TEST_VARIANCE:
			"Одинаковые настройки, независимые симуляции. Случайность игры и фоновая нагрузка всё равно влияют на результат.",
		DEVICE_TEST_METRIC: "Показатель",
		DEVICE_TEST_TICK: "Средний шаг симуляции, мс",
		DEVICE_TEST_P95: "P95 шага симуляции, мс",
		DEVICE_TEST_FRAME: "Средний интервал между кадрами, мс",
		DEVICE_TEST_STARTUP: "Запуск вычислений, мс",
		DEVICE_TEST_OWNER: "Фактическое выполнение",
		DEVICE_TEST_OWNER_worker: "Worker браузера",
		DEVICE_TEST_OWNER_main_thread: "Главный поток браузера (резервный режим)",
		DEVICE_TEST_OWNER_server: "Worker сервера",
		DEVICE_TEST_OWNER_unknown: "Не запущено",
		DEVICE_TEST_RESULTS_NOTE:
			"Меньше время — лучше. Память браузера, если доступна, не включает RAM сервера и может не учитывать worker и GPU. Байты транспорта указаны до сжатия.",
	},
};
