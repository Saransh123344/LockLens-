#include <napi.h>
#ifdef _WIN32
#include <windows.h>

HHOOK keyboardHook;

// The synchronous callback that intercepts the OS keys
LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION) {
        KBDLLHOOKSTRUCT *p = (KBDLLHOOKSTRUCT *)lParam;
        bool isKeyDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);

        if (isKeyDown) {
            // 0. THE EMERGENCY DEVELOPER HATCH: Ctrl + Shift + F12
            if (p->vkCode == VK_F12 && 
               (GetKeyState(VK_CONTROL) & 0x8000) && 
               (GetKeyState(VK_SHIFT) & 0x8000)) {
                
                // Instantly release the OS hook to guarantee you get your keyboard back
                UnhookWindowsHookEx(keyboardHook);
                keyboardHook = NULL;
                
                // Let the OS process the F12 so Electron can hear it and quit
                return CallNextHookEx(keyboardHook, nCode, wParam, lParam); 
            }

            // 1. Block standard Alt+Tab and Alt+Esc
            if ((p->vkCode == VK_TAB || p->vkCode == VK_ESCAPE) && (p->flags & LLKHF_ALTDOWN)) {
                return 1;
            }
            // 2. Block standard Windows Keys
            if (p->vkCode == VK_LWIN || p->vkCode == VK_RWIN) {
                return 1;
            }
            // 3. Block Ctrl+Esc
            if (p->vkCode == VK_ESCAPE && (GetKeyState(VK_CONTROL) & 0x8000)) {
                return 1;
            }
            // 4. Block Trackpad Gestures (Win+Tab, Win+D, Ctrl+Win+Left/Right)
            if (p->vkCode == VK_TAB || p->vkCode == 'D' || p->vkCode == VK_LEFT || p->vkCode == VK_RIGHT) {
                if ((GetKeyState(VK_LWIN) & 0x8000) || (GetKeyState(VK_RWIN) & 0x8000)) {
                    return 1; 
                }
            }
        }
    }
    return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
}

Napi::Boolean StartBlocking(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, LowLevelKeyboardProc, NULL, 0);
    return Napi::Boolean::New(env, keyboardHook != NULL);
}

Napi::Boolean StopBlocking(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool success = false;
    if (keyboardHook) {
        success = UnhookWindowsHookEx(keyboardHook);
        keyboardHook = NULL;
    }
    return Napi::Boolean::New(env, success);
}
#else
// Fallback for non-Windows (e.g., Linux Mint dev environment)
Napi::Boolean StartBlocking(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), true); }
Napi::Boolean StopBlocking(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), true); }
#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "start"), Napi::Function::New(env, StartBlocking));
    exports.Set(Napi::String::New(env, "stop"), Napi::Function::New(env, StopBlocking));
    return exports;
}

NODE_API_MODULE(keyboard_blocker, Init)