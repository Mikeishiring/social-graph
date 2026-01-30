import sys
sys.path.insert(0, 'src')

try:
    print("Testing imports...")
    from social_graph.api import app
    print("SUCCESS: All imports work!")
    print(f"App: {app}")
except Exception as e:
    print(f"ERROR: {e}")
    import traceback
    traceback.print_exc()
