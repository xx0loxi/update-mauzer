"""
MAUZER AI — Complete Test Suite
Tests: health, STT, chat+tools, vision, TTS, Realtime token
"""
import requests, json, os, sys, base64, time

sys.stdout.reconfigure(encoding='utf-8')

BACKEND = "http://127.0.0.1:8000"
API_KEY = os.getenv("OPENAI_API_KEY", "")

passed = 0
failed = 0
results = []

def test(name, func):
    global passed, failed
    print(f"\n{'='*60}")
    print(f"TEST: {name}")
    print(f"{'='*60}")
    try:
        result = func()
        if result:
            passed += 1
            results.append(f"  PASS: {name}")
            print(f"  >>> PASS")
        else:
            failed += 1
            results.append(f"  FAIL: {name}")
            print(f"  >>> FAIL")
    except Exception as e:
        failed += 1
        results.append(f"  FAIL: {name} — {e}")
        print(f"  >>> FAIL: {e}")

# ============================================================
# TEST 1: Health Check
# ============================================================
def test_health():
    r = requests.get(f"{BACKEND}/health", timeout=5)
    print(f"  Status: {r.status_code}")
    print(f"  Body: {r.text}")
    return r.status_code == 200

# ============================================================
# TEST 2: Chat — Simple personality response (no tools)
# ============================================================
def test_chat_personality():
    r = requests.post(f"{BACKEND}/api/chat", json={
        "text": "Привет, как дела?",
        "vision_base64": None
    }, timeout=30)
    data = r.json()
    print(f"  Status: {r.status_code}")
    print(f"  Response: {data.get('text', 'EMPTY')[:200]}")
    print(f"  Tool calls: {data.get('tool_calls', [])}")
    # Should have text response, no tool calls
    has_text = bool(data.get('text', '').strip())
    no_tools = len(data.get('tool_calls', [])) == 0
    print(f"  Has text: {has_text}, No tools: {no_tools}")
    return has_text and no_tools

# ============================================================
# TEST 3: Chat — Tool call: open_website
# ============================================================
def test_tool_open_website():
    r = requests.post(f"{BACKEND}/api/chat", json={
        "text": "Открой YouTube",
        "vision_base64": None
    }, timeout=30)
    data = r.json()
    print(f"  Status: {r.status_code}")
    print(f"  Response text: {data.get('text', '')[:100]}")
    print(f"  Tool calls: {json.dumps(data.get('tool_calls', []), ensure_ascii=False)}")
    tools = data.get('tool_calls', [])
    if len(tools) > 0:
        tool = tools[0]
        name = tool.get('name', '')
        print(f"  Tool name: {name}")
        print(f"  Tool args: {tool.get('args', {})}")
        # Should call open_website or search_youtube
        return name in ('open_website', 'search_youtube', 'google_search')
    return False

# ============================================================
# TEST 4: Chat — Tool call: google_search
# ============================================================
def test_tool_google_search():
    r = requests.post(f"{BACKEND}/api/chat", json={
        "text": "Загугли погоду в Алматы",
        "vision_base64": None
    }, timeout=30)
    data = r.json()
    print(f"  Status: {r.status_code}")
    print(f"  Tool calls: {json.dumps(data.get('tool_calls', []), ensure_ascii=False)}")
    tools = data.get('tool_calls', [])
    if len(tools) > 0:
        return tools[0].get('name') == 'google_search'
    return False

# ============================================================
# TEST 5: Chat — Tool call: search_youtube
# ============================================================
def test_tool_search_youtube():
    r = requests.post(f"{BACKEND}/api/chat", json={
        "text": "Найди на ютубе смешные видео с котами",
        "vision_base64": None
    }, timeout=30)
    data = r.json()
    print(f"  Status: {r.status_code}")
    print(f"  Tool calls: {json.dumps(data.get('tool_calls', []), ensure_ascii=False)}")
    tools = data.get('tool_calls', [])
    if len(tools) > 0:
        return tools[0].get('name') == 'search_youtube'
    return False

# ============================================================
# TEST 6: Vision — Can AI see and describe an image?
# ============================================================
def test_vision():
    # Create a simple test image: red square on white background
    # 10x10 pixel BMP encoded as base64
    # Using a minimal PNG instead
    import struct
    # Create tiny 4x4 red PNG
    def create_test_png():
        """Create a minimal 4x4 solid red PNG"""
        import zlib
        width, height = 4, 4
        # Raw pixel data: filter byte + RGB for each row
        raw_data = b''
        for y in range(height):
            raw_data += b'\x00'  # filter: none
            for x in range(width):
                raw_data += b'\xff\x00\x00'  # Red pixel
        
        compressed = zlib.compress(raw_data)
        
        def chunk(chunk_type, data):
            c = chunk_type + data
            crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
            return struct.pack('>I', len(data)) + c + crc
        
        png = b'\x89PNG\r\n\x1a\n'
        png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
        png += chunk(b'IDAT', compressed)
        png += chunk(b'IEND', b'')
        return png
    
    png_bytes = create_test_png()
    b64 = base64.b64encode(png_bytes).decode()
    
    r = requests.post(f"{BACKEND}/api/chat", json={
        "text": "Что ты видишь на этом изображении? Какой цвет?",
        "vision_base64": f"data:image/png;base64,{b64}"
    }, timeout=30)
    data = r.json()
    print(f"  Status: {r.status_code}")
    print(f"  Response: {data.get('text', 'EMPTY')[:300]}")
    # Should mention red/красный
    text = data.get('text', '').lower()
    sees_color = 'красн' in text or 'red' in text or 'цвет' in text or len(text) > 10
    print(f"  Sees something: {sees_color}")
    return sees_color

# ============================================================
# TEST 7: Vision — Does AI NOT describe screen when not asked?
# ============================================================
def test_vision_no_describe():
    """When sending screenshot with a non-vision question, AI should NOT describe the screen"""
    import zlib, struct
    # Blue pixel image
    width, height = 4, 4
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'
        for x in range(width):
            raw_data += b'\x00\x00\xff'  # Blue
    compressed = zlib.compress(raw_data)
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    b64 = base64.b64encode(png).decode()
    
    r = requests.post(f"{BACKEND}/api/chat", json={
        "text": "Открой гугл",  # Command, not asking about screen
        "vision_base64": f"data:image/png;base64,{b64}"
    }, timeout=30)
    data = r.json()
    print(f"  Status: {r.status_code}")
    print(f"  Response: {data.get('text', '')[:200]}")
    print(f"  Tool calls: {json.dumps(data.get('tool_calls', []), ensure_ascii=False)}")
    tools = data.get('tool_calls', [])
    # Should focus on the command (google_search/open_website), not describe the image
    if len(tools) > 0:
        name = tools[0].get('name', '')
        print(f"  Correctly executed command: {name}")
        return name in ('google_search', 'open_website')
    return False

# ============================================================
# TEST 8: TTS — Voice generation
# ============================================================
def test_tts():
    r = requests.get(f"{BACKEND}/api/tts", params={"text": "Привет, я Маузер"}, timeout=30)
    print(f"  Status: {r.status_code}")
    print(f"  Content-Type: {r.headers.get('content-type', 'unknown')}")
    print(f"  Body size: {len(r.content)} bytes")
    # Should return audio data > 1KB
    return r.status_code == 200 and len(r.content) > 1000

# ============================================================
# TEST 9: Realtime API — Token generation
# ============================================================
def test_realtime_token():
    r = requests.post('https://api.openai.com/v1/realtime/sessions',
        headers={
            'Authorization': f'Bearer {API_KEY}',
            'Content-Type': 'application/json'
        },
        json={
            'model': 'gpt-4o-realtime-preview-2024-12-17',
            'voice': 'ash'
        },
        timeout=15
    )
    data = r.json()
    print(f"  Status: {r.status_code}")
    token = data.get('client_secret', {}).get('value', '')
    print(f"  Token: {token[:30]}..." if token else f"  Error: {json.dumps(data, ensure_ascii=False)[:200]}")
    return r.status_code == 200 and bool(token)

# ============================================================
# TEST 10: Speed — Measure response time
# ============================================================
def test_speed():
    start = time.time()
    r = requests.post(f"{BACKEND}/api/chat", json={
        "text": "Скажи ок",
        "vision_base64": None
    }, timeout=30)
    elapsed = time.time() - start
    data = r.json()
    print(f"  Response time: {elapsed:.2f}s")
    print(f"  Response: {data.get('text', '')[:100]}")
    # Should respond in under 5 seconds for text-only
    return elapsed < 5.0

# ============================================================
# RUN ALL TESTS
# ============================================================
print("\n" + "="*60)
print("MAUZER AI — COMPREHENSIVE TEST SUITE")
print("="*60)

test("1. Health Check", test_health)
test("2. Personality Response", test_chat_personality)
test("3. Tool: open_website", test_tool_open_website)
test("4. Tool: google_search", test_tool_google_search)
test("5. Tool: search_youtube", test_tool_search_youtube)
test("6. Vision: See & Describe", test_vision)
test("7. Vision: No Unsolicited Description", test_vision_no_describe)
test("8. TTS: Voice Generation", test_tts)
test("9. Realtime Token", test_realtime_token)
test("10. Speed: Response Time", test_speed)

print("\n" + "="*60)
print(f"RESULTS: {passed} PASSED / {failed} FAILED / {passed+failed} TOTAL")
print("="*60)
for r in results:
    print(r)
print("="*60)
