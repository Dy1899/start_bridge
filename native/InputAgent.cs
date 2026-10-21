using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Threading;

class InputAgent {
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk,wScan; public uint dwFlags,time; public UIntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
    [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int n);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object Sync = new object();
    static readonly HashSet<int> Keys = new HashSet<int>();
    static readonly HashSet<string> Buttons = new HashSet<string>();
    static bool DryRun;
    static bool RelativeMode;
    static int RelativeEvents,RelativeX,RelativeY;
    static int X,Y,W,H;
    static DateTime LastPing=DateTime.UtcNow;
    static Dictionary<string,int> CodeMap = new Dictionary<string,int> {
        {"Escape",27},{"Tab",9},{"CapsLock",20},{"Backspace",8},{"Enter",13},{"Space",32},
        {"ShiftLeft",160},{"ShiftRight",161},{"ControlLeft",162},{"ControlRight",163},
        {"AltLeft",164},{"AltRight",165},{"MetaLeft",91},{"MetaRight",92},
        {"ArrowLeft",37},{"ArrowUp",38},{"ArrowRight",39},{"ArrowDown",40},
        {"Home",36},{"End",35},{"PageUp",33},{"PageDown",34},{"Insert",45},{"Delete",46},
        {"Backquote",192},{"Minus",189},{"Equal",187},{"BracketLeft",219},{"BracketRight",221},
        {"Backslash",220},{"Semicolon",186},{"Quote",222},{"Comma",188},{"Period",190},{"Slash",191},
        {"NumLock",144},{"NumpadAdd",107},{"NumpadSubtract",109},{"NumpadMultiply",106},
        {"NumpadDivide",111},{"NumpadDecimal",110},{"NumpadEnter",13}
    };
    static int KeyCode(string code) {
        int value;
        if (CodeMap.TryGetValue(code,out value)) return value;
        if (code.Length==4 && code.StartsWith("Key") && code[3]>='A' && code[3]<='Z') return code[3];
        if (code.Length==6 && code.StartsWith("Digit") && char.IsDigit(code[5])) return code[5];
        if (code.Length==7 && code.StartsWith("Numpad") && char.IsDigit(code[6])) return 96+code[6]-'0';
        if (code.StartsWith("F") && Int32.TryParse(code.Substring(1),out value) && value>=1 && value<=12) return 111+value;
        throw new Exception("Unsupported key");
    }
    static void Emit(INPUT input) {
        if (!DryRun && SendInput(1,new INPUT[]{input},Marshal.SizeOf(typeof(INPUT)))!=1) throw new Exception("Windows rejected input (possibly a protected desktop)");
    }
    static void Key(int vk,bool up) {
        uint flags=up?2u:0u;
        if ((vk>=33 && vk<=46)||vk==163||vk==165||vk==91||vk==92||vk==111) flags|=1;
        INPUT input=new INPUT(); input.type=1; input.data.ki.wVk=(ushort)vk; input.data.ki.dwFlags=flags;
        Emit(input);
    }
    static void Button(string name,bool up) {
        uint flags=name=="left"?(up?4u:2u):name=="right"?(up?16u:8u):name=="middle"?(up?64u:32u):0;
        if(flags==0)throw new Exception("Invalid button");
        INPUT input=new INPUT();input.data.mi.dwFlags=flags;Emit(input);
    }
    static void ReleaseAll() {
        foreach(int vk in new List<int>(Keys))try {Key(vk,true);}catch{}
        foreach(string button in new List<string>(Buttons))try {Button(button,true);}catch{}
        Keys.Clear();Buttons.Clear();
    }
    static double Number(Dictionary<string,object> m,string key,double min,double max) {
        double n=Convert.ToDouble(m[key],CultureInfo.InvariantCulture);
        if(Double.IsNaN(n)||Double.IsInfinity(n)||n<min||n>max)throw new Exception("Invalid numeric input");return n;
    }
    static void Process(Dictionary<string,object> m) {
        string type=Convert.ToString(m["type"],CultureInfo.InvariantCulture);
        if(type=="ping"){LastPing=DateTime.UtcNow;return;}
        if(type=="release"){ReleaseAll();RelativeMode=false;return;}
        if(type=="bounds") { X=(int)Number(m,"x",-100000,100000);Y=(int)Number(m,"y",-100000,100000);W=(int)Number(m,"width",1,32768);H=(int)Number(m,"height",1,32768);return; }
        if(W==0||H==0)throw new Exception("No approved display");
        if(type=="input-mode") {
            string mode=Convert.ToString(m["mode"]);if(mode!="relative"&&mode!="absolute")throw new Exception("Invalid input mode");
            ReleaseAll();RelativeMode=mode=="relative";return;
        }
        if(type=="relative") {
            if(!RelativeMode)throw new Exception("Relative input is not active");
            double dx=Number(m,"dx",-2048,2048),dy=Number(m,"dy",-2048,2048);
            if(dx!=Math.Truncate(dx)||dy!=Math.Truncate(dy)||(dx==0&&dy==0))throw new Exception("Invalid relative input");
            INPUT input=new INPUT();input.data.mi.dx=(int)dx;input.data.mi.dy=(int)dy;
            input.data.mi.dwFlags=0x2001;Emit(input);
            if(DryRun){RelativeEvents++;RelativeX+=(int)dx;RelativeY+=(int)dy;}return;
        }
        if(type=="move") {
            if(RelativeMode)throw new Exception("Absolute input is not active");
            double nx=Number(m,"x",0,1),ny=Number(m,"y",0,1);
            int vx=GetSystemMetrics(76),vy=GetSystemMetrics(77),vw=GetSystemMetrics(78),vh=GetSystemMetrics(79);
            INPUT input=new INPUT();
            input.data.mi.dx=(int)Math.Round(((X+nx*(W-1)-vx)*65535)/Math.Max(1,vw-1));
            input.data.mi.dy=(int)Math.Round(((Y+ny*(H-1)-vy)*65535)/Math.Max(1,vh-1));
            input.data.mi.dwFlags=0xC001;Emit(input);return;
        }
        if(type=="key") {
            string state=Convert.ToString(m["state"]);if(state!="up"&&state!="down")throw new Exception("Invalid key state");
            int vk=KeyCode(Convert.ToString(m["code"]));bool up=state=="up";
            if(up){if(Keys.Contains(vk)){Key(vk,true);Keys.Remove(vk);}}
            else if(!Keys.Contains(vk)){Key(vk,false);Keys.Add(vk);}return;
        }
        if(type=="button") {
            string state=Convert.ToString(m["state"]),name=Convert.ToString(m["button"]);
            if(state!="up"&&state!="down")throw new Exception("Invalid button state");
            if(state=="up"){if(Buttons.Contains(name)){Button(name,true);Buttons.Remove(name);}}
            else if(!Buttons.Contains(name)){Button(name,false);Buttons.Add(name);}return;
        }
        if(type=="wheel") {
            int delta=(int)Number(m,"delta",-1200,1200);INPUT input=new INPUT();input.data.mi.dwFlags=0x0800;input.data.mi.mouseData=unchecked((uint)delta);Emit(input);return;
        }
        throw new Exception("Unknown command");
    }
    static void Main(string[] args) {
        DryRun=Array.IndexOf(args,"--validate")>=0;
        try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch{}
        Console.WriteLine(Json.Serialize(new {ready=true,dryRun=DryRun,inputBytes=Marshal.SizeOf(typeof(INPUT)),relativeMouse=true}));
        Timer timer=new Timer(delegate(object state){lock(Sync){if((DateTime.UtcNow-LastPing).TotalSeconds>5){ReleaseAll();RelativeMode=false;}}},null,1000,1000);
        try {
            string line;
            while((line=Console.ReadLine())!=null) {
                if(line.Length>2048){Console.WriteLine("{\"ok\":false,\"error\":\"Message too large\"}");continue;}
                try {lock(Sync){Process(Json.Deserialize<Dictionary<string,object>>(line));}Console.WriteLine("{\"ok\":true}");}
                catch(Exception ex){Console.WriteLine(Json.Serialize(new{ok=false,error=ex.Message}));}
            }
        } finally {timer.Dispose();lock(Sync){ReleaseAll();if(DryRun)Console.WriteLine(Json.Serialize(new{validation=true,relativeEvents=RelativeEvents,relativeX=RelativeX,relativeY=RelativeY,relativeFlags=0x2001}));}}
    }
}
