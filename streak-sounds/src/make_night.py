import numpy as np, soundfile as sf
SR=48000; DUR=48.0; N=int(SR*DUR)
t=np.arange(N)/SR

def circ_noise(bands, seed):
    r=np.random.default_rng(seed)
    f=np.fft.rfftfreq(N,1/SR)
    mag=np.zeros_like(f)
    for lo,hi,g in bands:
        sel=(f>=lo)&(f<hi)
        mag[sel]=10**(g/20)
    ph=r.uniform(0,2*np.pi,len(f))
    spec=mag*np.exp(1j*ph); spec[0]=0
    x=np.fft.irfft(spec,N)
    rms=np.sqrt(np.mean(x**2))
    return x/rms if rms>0 else x

# per-channel independent noise -> real stereo
lowL=circ_noise([(28,110,0.0)],11);  lowR=circ_noise([(28,110,0.0)],21)
airL=circ_noise([(260,1500,-8.0)],12); airR=circ_noise([(260,1500,-8.0)],22)
hisL=circ_noise([(2600,9500,-22.0)],13); hisR=circ_noise([(2600,9500,-22.0)],23)

# slow swell, integer cycles in DUR (loop-periodic), slightly offset per channel
am1L=0.62+0.38*(0.5+0.5*np.sin(2*np.pi*3*t/DUR+0.7)); am1R=0.62+0.38*(0.5+0.5*np.sin(2*np.pi*3*t/DUR+2.4))
am2L=0.70+0.30*(0.5+0.5*np.sin(2*np.pi*5*t/DUR+2.1)); am2R=0.70+0.30*(0.5+0.5*np.sin(2*np.pi*5*t/DUR+5.0))
bedL=0.85*lowL+airL*am1L+hisL*am2L
bedR=0.85*lowR+airR*am1R+hisR*am2R
bedL/=np.sqrt(np.mean(bedL**2)); bedR/=np.sqrt(np.mean(bedR**2))

def pulse(f0,amp,dur_ms=6.5,harm=1.0,harmamp=0.0,harm_ms=4.0):
    n=int(SR*dur_ms/1000); tt=np.arange(n)/SR
    env=0.5-0.5*np.cos(2*np.pi*np.arange(n)/max(n-1,1))
    s=amp*env*np.sin(2*np.pi*f0*tt)
    if harmamp>0:
        nh=int(SR*harm_ms/1000); th=np.arange(nh)/SR
        e2=0.5-0.5*np.cos(2*np.pi*np.arange(nh)/max(nh-1,1))
        s[:nh]+=harmamp*amp*e2*np.sin(2*np.pi*f0*harm*th)
    return s

def cricket(f0,rate,phrase,gap,amp,pan,seed):
    r=np.random.default_rng(seed); out=np.zeros(N); pos=0.25+r.random()*0.5
    while pos < DUR-1.2:
        k=int(phrase*rate)
        for i in range(k):
            idx=int((pos+i/rate)*SR)
            f=f0*(1+0.01*r.standard_normal())
            p=pulse(f,amp,harm=1.5,harmamp=0.22)
            if idx+len(p) >= N: break
            out[idx:idx+len(p)] += p
        pos += phrase + gap*(0.6+r.random()*0.8)
    gL=0.5+0.5*(1-pan); gR=0.5+0.5*(1+pan)
    return out*gL, out*gR

cL=np.zeros(N); cR=np.zeros(N)
for (f0,rate,phrase,gap,amp,pan,seed) in [
    (4450,52,0.34,0.42,0.20,-0.60,101),
    (4780,47,0.28,0.55,0.16, 0.60,202),
    (4120,58,0.22,0.70,0.11, 0.05,303)]:
    l,r=cricket(f0,rate,phrase,gap,amp,pan,seed); cL+=l; cR+=r

bedL*=0.055; bedR*=0.055
L=np.tanh((bedL+cL)*1.2)/1.2; R=np.tanh((bedR+cR)*1.2)/1.2
x=np.stack([L,R],axis=1).astype(np.float32)
sf.write('/tmp/night3_raw.wav',x,SR,subtype='FLOAT')
print('peak',round(float(np.max(np.abs(x))),4))
