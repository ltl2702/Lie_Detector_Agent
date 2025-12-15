"""
Quick test script for Gemini API
"""
import os
from dotenv import load_dotenv
import google.generativeai as genai

# Load environment variables
load_dotenv()

# Get API key
api_key = os.getenv('GEMINI_API_KEY', '')

if not api_key:
    print("❌ GEMINI_API_KEY not found in .env file")
    exit(1)

print(f"✅ API Key found: {api_key[:10]}...{api_key[-5:]}")

# Configure Gemini
try:
    genai.configure(api_key=api_key)
    print("✅ Gemini configured successfully")
except Exception as e:
    print(f"❌ Error configuring Gemini: {e}")
    exit(1)

# Test with a simple prompt
try:
    print("\n🧪 Testing Gemini API with simple prompt...")
    model = genai.GenerativeModel('gemini-2.5-flash')
    
    test_prompt = """Phân tích ngắn gọn phiên phỏng vấn:
- Thời lượng: 1 phút 30 giây  
- Số tells: 3 (hand-face contact, lip compression, decreased blinking)
- BPM: 75

Trả lời JSON:
{
  "summary": "Tóm tắt ngắn",
  "suspicion_level": "LOW/MEDIUM/HIGH",
  "suspicion_score": 0-100,
  "recommendation": "Khuyến nghị",
  "reasoning": "Lý do"
}
"""
    
    response = model.generate_content(test_prompt)
    print("✅ API call successful!")
    print("\n📝 Response:")
    print(response.text)
    
    # Try to parse as JSON
    import json
    response_text = response.text.strip()
    if response_text.startswith('```json'):
        response_text = response_text[7:]
    if response_text.startswith('```'):
        response_text = response_text[3:]
    if response_text.endswith('```'):
        response_text = response_text[:-3]
    response_text = response_text.strip()
    
    try:
        parsed = json.loads(response_text)
        print("\n✅ JSON parsing successful!")
        print(f"   Suspicion Level: {parsed.get('suspicion_level', 'N/A')}")
        print(f"   Score: {parsed.get('suspicion_score', 'N/A')}")
    except json.JSONDecodeError as e:
        print(f"\n⚠️ JSON parsing failed: {e}")
        print("   (This is OK, we'll handle it in the app)")
    
    print("\n🎉 Gemini API is working correctly!")
    print("   You can now use AI Analysis in your app.")
    
except Exception as e:
    print(f"\n❌ Error testing API: {e}")
    import traceback
    traceback.print_exc()
    exit(1)
