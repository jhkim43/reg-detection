# 🔮 Obsidian AI Commander: VM-to-Host Integration

이 프로젝트는 Oracle VM 내부의 나노봇(AI Agent)이 호스트 OS(Windows)에서 실행 중인 Obsidian Local REST API에 접근하여 지식 베이스를 실시간으로 관리하고 그래프 뷰를 확장할 수 있도록 설계되었습니다.

---
## 🌐 Network Architecture

* **Guest (VM):** Ubuntu Linux (Docker-based Nanobot)
* **Host (PC):** Windows 11 (Obsidian App)
* **Bridge IP:** `192.168.56.1` (Host-Only Adapter)
* **Target Port:** `27123`

---

## 🔌 Step 0: Obsidian 플러그인 설치 및 설정 (Prerequisites)

나노봇이 옵시디언과 통신하기 위해서는 Local REST API 플러그인이 올바르게 활성화되어 있어야 합니다.

1. **플러그인 설치**
- Obsidian 실행 후 Settings(설정) > Community plugins 이동.
- Browse 버튼을 누르고 Local REST API 검색 후 설치(Install) 및 활성화(Enable).


2. **핵심 보안 및 네트워크 설정**

- 플러그인 설정 화면에서 아래 항목들을 반드시 확인하세요.

- Enable Non-SSL (HTTP) Server: ON (활성화)

- 나노봇 컨테이너와 호스트 간의 복잡한 인증서 문제를 피하기 위해 HTTP 통신을 허용합니다. (포트: 27123)

- Secure Server (HTTPS): OFF (비활성화 권장)

- SSL을 사용할 경우 https://... 주소와 별도의 인증서 설정이 필요하므로, 로컬 환경에서는 끄는 것이 간편합니다.

- API Key (Authorization Token):

- 설정 상단에 표시된 긴 문자열을 복사하여 나노봇 SKILL.md의 {{TOKEN}} 자리에 넣습니다.

- Enable Write Actions: ON (활성화)



## 🛠️ Step 1: Windows Port Proxy 설정 (Port Forwarding)

오라클 VM에서 호스트의 `127.0.0.1`로 직접 접근하는 것이 불가능하므로, 호스트-온리 어댑터 IP(`192.168.56.1`)로 들어오는 신호를 로컬 호스트로 전달해야 합니다.

1. **관리자 권한으로 PowerShell 또는 mobaxterm 실행**
2. **기존 프록시 초기화 (선택 사항):**
    ```powershell
    $ netsh interface portproxy reset
    ```

3. **포트 프록시 추가:**
    ```powershell
    $ netsh interface portproxy add v4tov4 listenport=27123 listenaddress=192.168.56.1 connectport=27123 connectaddress=127.0.0.1
    ```
4.  **설정 확인:**
    ```powershell
    $ netsh interface portproxy show all

    ipv4 수신 대기:             ipv4에 연결:
    주소            포트        주소            포트
    --------------- ----------  --------------- ----------
    192.168.56.1    27123       127.0.0.1       27123
    ```
---

## 🛡️ Step 2: Windows 방화벽 인바운드 규칙 개방

외부(VM)에서 들어오는 27123 포트 요청을 허용하기 위해 방화벽 규칙을 수동으로 추가해야 합니다.

1.  **제어판 > 시스템 및 보안 > Windows Defender 방화벽** 이동.
2.  좌측 메뉴의 **고급 설정** 클릭.
3.  **인바운드 규칙** 선택 후 우측의 **새 규칙...** 클릭.
4.  **규칙 종류:** `포트(O)` 선택 -> 다음.
5.  **프로토콜 및 포트:** `TCP`, 특정 로컬 포트에 `27123` 입력 -> 다음.
6.  **작업:** `연결 허용(A)` 선택 -> 다음.
7.  **프로필:** `도메인`, `개인`, `공용` 모두 체크 (보안 환경에 따라 선택) -> 다음.
8.  **이름:** `Obsidian Local REST API` 입력 후 마침.

---

## 🚀 Step 3: VM 연결 테스트 (Verification)

VM 터미널에서 호스트로 신호를 보내 정상 응답(HTTP 200)이 오는지 확인합니다.

```bash
$ curl -I http://192.168.56.1:27123
```

**정상 응답 예시:**

```text
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
...
```

---

## 🤖 Step 4: AI Skill Implementation

나노봇이 옵시디언을 제어할 수 있도록 `SKILL.md`를 통해 명령어를 정의합니다.

### 핵심 기능 (Operational Skills)

* **Search:** 보관함 내 키워드 검색 및 지식 연결 상태 파악.
* **Read/Write:** 노트 내용 조회 및 실시간 업데이트.
* **Graph Expansion:** `[[Link]]` 및 `#Tag`를 자동 삽입하여 그래프 시각화 유도.

### ⚠️ SSRF Whitelist 등록

나노봇 내부 SSRF 방어 로직이 작동 중이라면, 아래 주소를 `~/.nanobot/config.json`에 등록해야 합니다.

* **`ssrfWhitelist`** : `192.168.56.1/32`

---