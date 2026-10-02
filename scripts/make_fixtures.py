"""Generate example Touchstone files and golden reference values with scikit-rf.

Run:  python3 scripts/make_fixtures.py
Requires: scikit-rf, numpy. Outputs public/examples/*.sNp and tests/fixtures/skrf_golden.json
"""
import json, numpy as np, skrf as rf
from skrf.constants import c as C_LIGHT

out_ex = 'public/examples/'
out_fx = 'tests/fixtures/'

# 1) Pozar Example 5.2 load: series 60 ohm + 0.995 pF, 1-3 GHz, 201 points, 50 ohm, DB format
f = rf.Frequency(1, 3, 201, 'GHz')
w = 2*np.pi*f.f
Z = 60 + 1/(1j*w*0.995e-12)
G = (Z-50)/(Z+50)
n = rf.Network(frequency=f, s=G.reshape(-1,1,1), z0=50, name='pozar_ex5_2_series_RC_load')
n.write_touchstone(out_ex + 'pozar_ex5_2_RC_load', form='db')

# 2) Antenna-like series RLC resonator with radiation resistance, 2.2-2.7 GHz, MA format
f2 = rf.Frequency(2.2, 2.7, 251, 'GHz')
w2 = 2*np.pi*f2.f
R, L, C = 38.0, 18e-9, 1/((2*np.pi*2.45e9)**2*18e-9)
Z2 = R + 1j*w2*L + 1/(1j*w2*C) + 1j*w2*0.6e-9  # plus a little feed inductance
G2 = (Z2-50)/(Z2+50)
n2 = rf.Network(frequency=f2, s=G2.reshape(-1,1,1), z0=50, name='patch_antenna_2g45')
n2.write_touchstone(out_ex + 'antenna_2g45', form='ma')

# 3) Two-port: 30 ohm, 0.3 lambda@1GHz lossy line terminated nothing (2-port of line section), RI
f3 = rf.Frequency(0.5, 2.0, 151, 'GHz')
media = rf.media.DefinedGammaZ0(frequency=f3, z0_port=50, z0=30, gamma=(0.02+1j)*2*np.pi*f3.f/C_LIGHT)
line = media.line(0.3*C_LIGHT/1e9, 'm', name='line_30ohm')
line.write_touchstone(out_ex + 'line_30ohm_section', form='ri')

# Golden values ------------------------------------------------------------
golden = {}
# (a) Line input impedance: load 40+j70 on 100 ohm line, 0.3 lambda (Pozar Ex 2.2)
fq = rf.Frequency(1, 1, 1, 'GHz')
m100 = rf.media.DefinedGammaZ0(frequency=fq, z0_port=100, z0=100)
ld = m100.load(rf.tlineFunctions.zl_2_Gamma0(100, 40+70j)[0])
net = m100.line(108, 'deg') ** ld
zin = net.z[0,0,0]
golden['ex22_zin'] = [zin.real, zin.imag]
# (b) Pozar Ex 5.2 load S11 at 2 GHz from the generated file
golden['ex52_file_2GHz'] = [n.s[100,0,0].real, n.s[100,0,0].imag, float(n.f[100])]
# (c) 2-port line S-params at 1 GHz
k = int(np.argmin(abs(f3.f-1e9)))
s = line.s[k]
golden['line_2port_1GHz'] = {'f': float(f3.f[k]), 's11': [s[0,0].real, s[0,0].imag], 's21': [s[1,0].real, s[1,0].imag], 's22': [s[1,1].real, s[1,1].imag]}
# (d) Lossy line: load 15-j45 on 50 ohm, alpha*l = 1.5 dB, 0.37 lambda
m50 = rf.media.DefinedGammaZ0(frequency=fq, z0_port=50, z0=50, gamma=(1.5/8.685889638065035/(0.37*C_LIGHT/1e9)) + 1j*2*np.pi*1e9/C_LIGHT)
ld2 = m50.load(rf.tlineFunctions.zl_2_Gamma0(50, 15-45j)[0])
z2 = (m50.line(0.37*C_LIGHT/1e9, 'm') ** ld2).z[0,0,0]
golden['lossy_zin'] = [z2.real, z2.imag]
# (e) VSWR / RL for a few gammas
json.dump(golden, open(out_fx + 'skrf_golden.json','w'), indent=1)
print(json.dumps(golden, indent=1))

# 4) Synthetic non-reciprocal amplifier-like 2-port (MA format) for S11/S22 plotting and port-order tests
f4 = rf.Frequency(0.5, 6.0, 111, 'GHz')
x = f4.f/1e9
s4 = np.zeros((len(x),2,2), dtype=complex)
s4[:,0,0] = (0.75 - 0.04*x) * np.exp(-1j*np.deg2rad(40 + 22*x))
s4[:,1,0] = (8.0/np.sqrt(1+(x/2.0)**2)) * np.exp(1j*np.deg2rad(150 - 20*x))
s4[:,0,1] = (0.03 + 0.008*x) * np.exp(1j*np.deg2rad(70 - 8*x))
s4[:,1,1] = (0.62 - 0.03*x) * np.exp(-1j*np.deg2rad(25 + 15*x))
n4 = rf.Network(frequency=f4, s=s4, z0=50, name='synthetic_amplifier')
n4.write_touchstone(out_ex + 'synthetic_amplifier', form='ma')
k4 = int(np.argmin(abs(f4.f-3e9)))
golden['amp_3GHz'] = {'f': float(f4.f[k4]), 's12': [s4[k4,0,1].real, s4[k4,0,1].imag], 's21': [s4[k4,1,0].real, s4[k4,1,0].imag]}
json.dump(golden, open(out_fx + 'skrf_golden.json','w'), indent=1)
print('amp ok')
