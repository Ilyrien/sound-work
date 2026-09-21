import numpy as np, soundfile as sf
SR=48000

def write(name, x, dur):
    x=x.astype(np.float32)
    sf.write(f'/tmp/{name}_raw.wav', x, SR, subtype='FLOAT')
    n=len(x); d=np.abs(np.diff(x,axis=0)).max(axis=1)
    wrap=float(np.abs(x[0]-x[-1]).max())
    print(name,'peak',round(float(np.max(np.abs(x))),4),
          'wrap pct',round(float((d<wrap).mean()*100),1),
          'mean diff',round(float(d.mean()),4))

# ---------- brown noise: 1/f amplitude, circular (exactly periodic) ----------
def brown(dur, seed):
    N=int(SR*dur); r=np.random.default_rng(seed)
    f=np.fft.rfftfreq(N,1/SR)
    amp=np.where(f<25, 0.0, 1.0/np.maximum(f,1.0))
    amp*= 1.0/(1.0+(np.maximum(f,1.0)/9000.0)**2)      # gentle top rolloff
    ph=r.uniform(0,2*np.pi,len(f)); spec=amp*np.exp(1j*ph); spec[0]=0
    x=np.fft.irfft(spec,N)
    x/=np.sqrt(np.mean(x**2))
    return x
L=brown(60.0,7); R=brown(60.0,8)          # decorrelated channels
x=np.stack([L,R],axis=1)*0.16
write('brown', x, 60.0)

# ---------- warm pad: pure sines snapped to the loop grid (perfectly periodic) ----------
def pad(dur, seed):
    N=int(SR*dur); t=np.arange(N)/SR
    grid=1.0/dur                                        # frequency quantum
    def snap(f): return round(f/grid)*grid
    notes=[(55.0,1.00),(82.41,0.62),(110.0,0.70),(164.81,0.40),(220.0,0.34),(277.18,0.20),(329.63,0.14)]
    L=np.zeros(N); R=np.zeros(N)
    r=np.random.default_rng(seed)
    for i,(f,a) in enumerate(notes):
        f0=snap(f)
        for det,ga,pan in [(0.0,a,0.0),(0.0016,a*0.55,-0.25),( -0.0013,a*0.55,0.25)]:
            fd=snap(f*(1+det))
            ph=r.uniform(0,2*np.pi)
            # slow, loop-periodic amplitude breathing
            cyc=int(1+i%3); lfo=0.82+0.18*(0.5+0.5*np.sin(2*np.pi*cyc*t/dur+r.uniform(0,6)))
            s=ga*lfo*np.sin(2*np.pi*fd*t+ph)
            L+=s*(1-0.5*abs(pan))*(1 if pan<=0 else 0.55)
            R+=s*(1-0.5*abs(pan))*(1 if pan>=0 else 0.55)
    m=max(np.max(np.abs(L)),np.max(np.abs(R)))
    return np.stack([L,R],axis=1)/m
x=pad(60.0,21)*0.30
write('pad', x, 60.0)
