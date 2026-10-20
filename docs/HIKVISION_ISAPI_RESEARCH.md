# Hikvision DeepinView / ISAPI event integration: research notes

Researched 2026-10-20. Target: DeepinView iDS-2CD7xxx cameras (firmware 5.5.x–5.7.x) pushing events to a NestJS API on the clinic LAN.

**How to read this file**
- Each claim names its source by tag (S1, S2, …). The source list is at the end.
- Payloads marked **verbatim** were copied from the source. Payloads from PDFs went through text extraction, so line breaks and indentation may differ; field names and values were not changed.
- **Doc comments** inside samples (`/* … */`, `<!-- … -->`) belong to Hikvision's documentation, not to the wire payload. Remove them before using a sample as a test fixture.
- **UNVERIFIED** marks anything not confirmed by a source.
- Hikvision's full ISAPI documents (Facial, People Counting, Behavior Analysis) sit behind the TPP portal and an MLA. The tpp.hikvision.com wiki returned 403 or redirected for every page tried, so this research relies on:
  - the public *General Application* guide (S1);
  - Hikvision Europe integration PDFs;
  - open.hikvision.com SDK/ISAPI definitions (Chinese);
  - real-device fixtures from open-source projects.

---

## 1. Event delivery options

### 1a. HTTP listening / alarm server push: `httpHosts`

**Endpoints** (S1 §15.3.5–15.3.7, pp. 152–154)

| Method and URL | Purpose |
|---|---|
| `GET /ISAPI/Event/notification/httpHosts` | List all hosts. Response: `XML_HttpHostNotificationList`. |
| `PUT /ISAPI/Event/notification/httpHosts` | Replace all hosts. Request: `XML_HttpHostNotificationList`. Response: `XML_ResponseStatus`. |
| `POST /ISAPI/Event/notification/httpHosts` | Add one host. Request: `XML_HttpHostNotification`. |
| `DELETE /ISAPI/Event/notification/httpHosts` | Delete all hosts. |
| `GET/PUT/DELETE /ISAPI/Event/notification/httpHosts/<ID>` | Manage a single host (S1 TOC; tpp wiki title in search results). |
| `POST /ISAPI/Event/notification/httpHosts/<ID>/test` | Test the host. Response: `XML_HttpHostTestResult` with `<errorDescription>`. |
| `GET /ISAPI/Event/notification/httpHosts/capabilities` | Get `XML_HttpHostNotificationCap`. |

**Optional `?security=1|2` query** on GET/PUT/POST: the sensitive nodes (user name/password) are AES128-CBC (1) or AES256-CBC (2) encrypted.

**Documented setup flow** (S1 §12.2, p. 93):
1. GET capabilities.
2. PUT httpHosts. S1 suggests a GET first to use the current values as a template.
3. POST `/httpHosts/<ID>/test`.
4. The device then POSTs to `http://ipAddress:portNo/url`.

**Schema `XML_HttpHostNotification`** (S1 p. 605–606, verbatim)

```xml
<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <id><!--req, xs:string, ID--></id>
  <url><!--req, xs:string, the absolute path, e.g., http://<ipAddress>:<portNo>/<uri>--></url>
  <protocolType><!--req, xs:string, "HTTP ,HTTPS,EHome"--></protocolType>
  <parameterFormatType><!--req, xs:string, alarm/event information format, "XML,JSON"--></parameterFormatType>
  <addressingFormatType><!--req, xs:string, "ipaddress,hostname"--></addressingFormatType>
  <hostName><!--dep, xs:string--></hostName>
  <ipAddress><!--dep, xs:string--></ipAddress>
  <ipv6Address><!--dep, xs:string--></ipv6Address>
  <portNo><!--opt, xs:integer--></portNo>
  <userName><!--dep, xs:string--></userName>
  <password><!--dep, xs:string--></password>
  <httpAuthenticationMethod><!--req, xs:string, "MD5digest,none"--></httpAuthenticationMethod>
  <eventType opt="AID,TFS,TPS"><!--req, xs:string--></eventType>
  <uploadImagesDataType>
    <!--opt, xs:string, "URL", "binary" (default), for cloud storage, only "URL" is supported-->
  </uploadImagesDataType>
  <eventMode><!--opt, xs:string, "all,list"--></eventMode>
  <EventList><!--dep, it is valid only when eventMode is "list"-->
    <Event><!--req-->
      <type><!--req, xs:string--></type>
    </Event>
  </EventList>
  <channels><!--opt, xs:string, "1,2,3,4…"--></channels>
  <SubscribeEvent/><!--opt, event subscription parameters, see details in the message of XML_SubscribeEvent-->
</HttpHostNotification>
```

**Capability example** (S1 p. 606, verbatim). Values vary per device; this sample device allowed only HTTP, XML and no listener authentication:

```xml
<HttpHostNotificationCap version="2.0" xmlns="http://www.isapi.com/ver20/XMLSchema">
  <hostNumber>3</hostNumber>
  <urlLen max="64" />
  <protocolType opt="HTTP" />
  <parameterFormatType opt="XML" />
  <addressingFormatType opt="ipaddress,hostname" />
  <ipAddress opt="ipv4,ipv6" />
  <portNo min="1" max="65535" />
  <userNameLen min="5" max="32" />
  <passwordLen min="5" max="32" />
  <httpAuthenticationMethod opt="none" />
  <uploadImagesDataType opt="URL,binary" />
</HttpHostNotificationCap>
```

The full capability schema also lists `parameterFormatType opt="XML,querystring,JSON"`. The open.hikvision.com definition of the same message (S10a) has the same core fields and adds `uploadImagesDataType "URL,binary"`.

**Real device GET response**, DS-2CD2xxx G2 IP camera, from hikvision_next fixture `ipc_list.xml` (S11a). Verbatim, first host shown; the file also has hosts 2 and 3 set to `0.0.0.0:80`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<HttpHostNotificationList version="2.0"
  xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <HttpHostNotification version="2.0"
    xmlns="http://www.hikvision.com/ver20/XMLSchema">
    <id>1</id>
    <url>/api/hikvision</url>
    <protocolType>HTTP</protocolType>
    <parameterFormatType>XML</parameterFormatType>
    <addressingFormatType>ipaddress</addressingFormatType>
    <ipAddress>1.0.0.20</ipAddress>
    <portNo>8123</portNo>
    <userName></userName>
    <httpAuthenticationMethod>none</httpAuthenticationMethod>
    <httpBroken>false</httpBroken>
  </HttpHostNotification>
  ...
</HttpHostNotificationList>
```

**PUT body accepted by a single camera** with HTTPS and a hostname (S11b `set_alarm_server_outside_network_payload.xml`, also quoted in S12). Verbatim:

```xml
<?xml version="1.0" encoding="utf-8"?>
<HttpHostNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><HttpHostNotification><id>1</id><url>/api/hikvision</url><protocolType>HTTPS</protocolType><parameterFormatType>XML</parameterFormatType><addressingFormatType>hostname</addressingFormatType><portNo>443</portNo><httpAuthenticationMethod>none</httpAuthenticationMethod><Extensions xmlns="urn:selfextension:psiaext-ver10-xsd"><intervalBetweenEvents>0</intervalBetweenEvents></Extensions><hostName>ha.hostname.domain</hostName></HttpHostNotification></HttpHostNotificationList>
```

**Hikvision Europe Postman example** (S2 screenshot, transcribed):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<HttpHostNotificationList version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
    <HttpHostNotification version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
        <id>1</id>
        <url>/</url>
        <protocolType>HTTP</protocolType>
        <parameterFormatType>XML</parameterFormatType>
        <addressingFormatType>ipaddress</addressingFormatType>
        <ipAddress>10.25.103.30</ipAddress>
        <portNo>8088</portNo>
        <userName></userName>
        <httpAuthenticationMethod>none</httpAuthenticationMethod>
    </HttpHostNotification>
</HttpHostNotificationList>
```

The camera answered `<statusCode>1</statusCode><statusString>OK</statusString>`. The camera web UI equivalent is *Configuration → Network → Advanced Settings → HTTP Listening*, with columns "Destination IP or Host Name / URL / Protocol / Port / Test" (S2 screenshot).

**Answers to the specific questions**

- **`url` content.** Real devices store only the path (e.g. `/api/hikvision`, `/`), even though the S1 comment says "absolute path, e.g. http://…" (S11a, S2).
  - Maximum length is 64 characters (S1 cap example `urlLen max="64"`; S7 p. 13: "The max size of 'host name' and 'url' are 64 ASICC").
  - A secret token in the path is therefore possible as long as the URL stays within 64 characters. **UNVERIFIED:** whether a query string (`?token=…`) is preserved. One third-party library suggests `?device=` (S19 README), but no device capture confirms it. Use a path segment, not a query string.
- **Host count.** "The max host IP number is 3" (S7 p. 13); the capability example shows `hostNumber 3`.
- **HTTPS.** Allowed by the schema (`"HTTP ,HTTPS,EHome"`), but support depends on firmware:
  - In S12 (hikvision_next issue #179) the integration author says "single camera accepts that [HTTPS + hostname], NVR returns 400 bad content".
  - A user with NVR DS-7604NI-K1 reports `<protocolType>HTTPS</protocolType>` → "Invalid XML Content", and that a PUT hostname "does not persist" even though OK was returned.
  - **UNVERIFIED:** for iDS-2CD7xxx 5.5–5.7, whether HTTPS push validates the server certificate (self-signed vs public CA), which TLS versions it uses, and whether SNI is sent. Read `/httpHosts/capabilities` on the real camera.
- **Public hostname.** `addressingFormatType=hostname` plus `<hostName>` is documented and accepted by a single IP camera (S12). The camera must be able to resolve DNS (DNS set in its network settings). Whether it can reach a public Internet host depends on the clinic network.
- **Listener authentication.** `httpAuthenticationMethod` is `"MD5digest,none"`. With MD5digest the camera authenticates to *our* server using `<userName>/<password>` (5–32 characters).
  - The example device advertised only `none`.
  - **UNVERIFIED:** whether DeepinView 5.5–5.7 advertises `MD5digest`.
- **Retries and resend.** No documented retry policy for a failed POST was found (**UNVERIFIED**). Related signs of "resend after network break" (ANR) exist:
  - Real camera hosts carry `<httpBroken>false</httpBroken>` (S11a).
  - Real events carry `<isDataRetransmission>false</isDataRetransmission>` (S11c).
  - The SDK face-match struct has `byBrokenNetHttp` = "断网续传标志位：0-不是重传数据，1-重传数据" (resume-after-network-break flag: 0 = not retransmitted, 1 = retransmitted) (S10h).
  - Inferred: with HTTP-ANR enabled, events buffered during an outage may be re-sent later with `isDataRetransmission=true`. The receiver must deduplicate.
- **Per-event throttling.** NVRs and some cameras return `<Extensions><intervalBetweenEvents>` (seconds) inside the host entry (S11b, S12).
- **Connection style.** Listening mode is "HTTP short connection, Connection: close" (S7 p. 15). Expected response: `HTTP/1.1 HTTP statusCode … Connection: close` (S1 p. 94). Return 200 quickly. hikvision_next returns 200 `text/plain` even when it fails to parse (S11e).
- **Web UI prerequisite** (S7 p. 13; S11 README): each event's *Linkage Method* must have **"Notify Surveillance Center"** ticked, plus an arming schedule. For counting, "Enable real-time uploading" is also needed. Otherwise nothing is pushed.
- **Latency.** One NVR user reports 1–20 s variation in listening mode (hikvision_next issue #318, https://github.com/maciej-or/hikvision_next/issues/318). The maintainer replied "it seems to be device dependent".

### 1b. Pull: `alertStream` ("arming mode")

S1 §12.1 pp. 90–92 and §15.3.4 p. 152. Verbatim sample (with `<frontier>` as written in the doc):

```
GET /ISAPI/Event/notification/alertStream HTTP/1.1
Host: data_gateway_ip
Connection: Keep-Alive

HTTP/1.1 401 Unauthorized
...
WWW-Authenticate: Digest qop="auth",
realm="IP Camera(C2183)",
nonce="4e5468694e7a42694e7a4d364f4449354d7a6b354d54513d",
stale="FALSE"

GET /ISAPI/Event/notification/alertStream HTTP/1.1
Authorization: Digest username="admin",
realm="IP Camera(C2183)",
nonce="4e5468694e7a42694e7a4d364f4449354d7a6b354d54513d",
uri="/ISAPI/Event/notification/alertStream",
cnonce="3d183a245b8729121ae4ca3d41b90f18",
nc=00000001,
qop="auth",
response="f2e0728991bb031f83df557a8f185178"
Host: 10.6.165.192

HTTP/1.1 200 OK
MIME-Version: 1.0
Connection: close
Content-Type: multipart/mixed; boundary=<frontier>

--<frontier>
Content-Type: application/xml; charset="UTF-8"
Content-Length: text_length

<EventNotificationAlert/>
--<frontier>
```

S1 note: "Some alarm data is in JSON format, so the Content-Type may be "application/xml" or "application/json"."

**Heartbeat** (S1 §16.2.129 p. 586–587)

- In alertStream, a heartbeat is `eventType=videoloss` with `eventState=inactive`.
- Interval: "For network camera … with the version 5.5.0 and higher, the heartbeat frequency is 10 s per heartbeat. If no heartbeat received for continuous 30 s, it indicates that the heartbeat is timed out." Below 5.5.0 the interval is 300 ms.

Verbatim heartbeat:

```xml
<EventNotificationAlert version="2.0" xmlns="http://www.isapi.com/ver20/XMLSchema">
  <ipAddress>10.17.133.46</ipAddress>
  <portNo>80</portNo>
  <protocol>HTTP</protocol>
  <macAddress>44:19:b6:6d:24:85</macAddress>
  <channelID>1</channelID>
  <dateTime>2017-05-04T11:20:02+08:00</dateTime>
  <activePostCount>0</activePostCount>
  <eventType>videoloss</eventType>
  <eventState>inactive</eventState>
  <eventDescription>videoloss alarm</eventDescription>
</EventNotificationAlert>
```

With `POST /ISAPI/Event/notification/subscribeEvent` (subscription arming, S1 §12.3, §15.3.8) the heartbeat is different: `eventType=heartBeat`, `eventState=active`, default every 30 s (S1 §16.2.131).

**Parser notes**
- Boundary values seen in the wild: `boundary=boundary` (S3, S17 default) and `MIME_boundary` (S14, S15 tests for access terminals). Some devices quote the boundary or prefix it with `--` (S14 test: `'multipart/mixed; boundary="--MIME_boundary"'`).
- Parts may carry `Content-Length`. Parsers should honour it, because JPEG bytes can contain boundary-like sequences (S17 `alertStreamParser.js`: "A declared length takes precedence over boundary-like bytes").
- Reconnect if no message (event or heartbeat) arrives for ~30–40 s. S17 uses 40 s; S1 says 30 s.

**Trade-offs** (S7 p. 15). Arm mode: short delay and connection reuse, but "Not friendly to firewall … Need to set heartbeat". Listen mode: "Easy to do integration, low pressure for the server".

### 1c. Wire format of a pushed event

S1 §12.2 pp. 93–94, verbatim. With picture:

```
POST requestUrl HTTP/1.1
Host: data_gateway_ip:port
Accept-Language: en-US
Date: YourDate
Content-Type: multipart/form-data;boundary=<frontier>
Content-Length: body_length
Connection: keep-alive

--<frontier>
Content-Disposition: form-data; name="Event_Type"
Content-Type: text/xml
Content-Length: xml_length

<EventNotificationAlert/>
--<frontier>
Content-Disposition: form-data; name="Picture_Name"
Content-Length: image_length
Content-Type: image/pjpeg

[binary picture data]
--<frontier>--
```

Without a picture, the body is a single `Content-Type: text/xml;` with `<EventNotificationAlert/>`. S1 note: "Some alarm data is in JSON format, so the Content-Type may be "text/xml" or "text/json"."

`Event_Type` and `Picture_Name` in this doc sample are placeholders. Real devices use event-specific part names:

| Event / device | Part names and content types | Source |
|---|---|---|
| Face capture, thermal camera | `name="faceCapture"`, `application/json; charset="UTF-8"`; then `name="facePicture"; filename="facePicture.jpg"`, `image/jpeg`. Outer `Content-Type: multipart/form-data; boundary=boundary`, `Connection: Keep-Alive`. | S3 p. 12–14 |
| Face capture, another camera | `Content-Disposition: form-data; name="faceCapture"`, `Content-Type: application/json; charset="UTF-8"` | S2 screenshot |
| PeopleCounting, iDS-2CD7xxx 5.5.804 | **Not multipart**: `POST / HTTP/1.1`, `Content-Type: application/xml; charset="UTF-8"`, `Connection: Close`, plain XML body | S6 p. 18–19 |
| MinMoe access terminals | `name="AccessControllerEvent"` (JSON) + `name="Picture"` (`image/jpeg`), boundary `MIME_boundary` | S15 test (third-party test, built to mimic devices) |

The receiver must handle all of these:
- plain `application/xml`, `text/xml`, `application/json`, `text/json`;
- `multipart/form-data` (listening);
- `multipart/mixed` (alertStream);
- several image parts, e.g. background + face. S3 shows two pictures, "Background picture" and "Face capture picture", and a `contentID` field that refers to them.

hikvision_next (S11e) handles the case with `MultipartDecoder`: it takes the part whose content type is XML and ignores `image/jpeg`.

**Parser trap.** The real faceCapture JSON in S3 contains a duplicate key (`"contentID": "backgroundImage", "contentID": "thermalPicture"`). `JSON.parse` keeps the last value. Never rely on `contentID` being unique.

---

## 2. Payload formats

### 2.0 Common envelope

**XML** (S1 §16.2.128 p. 585–586; S10b). Fields:
- `ipAddress`, `ipv6Address`, `portNo`, `protocol` ("HTTP, HTTPS");
- `macAddress`, `channelID` (string, from 1);
- `dateTime` ("format: 2017-07-19T10:06:41+08:00");
- `activePostCount` ("alarm/event frequency, starts from 1"; S10b: number of times the device triggered the alarm for the same target);
- `eventType`, `eventState` ("active"/"inactive"), `eventDescription`, `channelName` (optional).

Namespaces differ by device generation and must be handled:
- `http://www.hikvision.com/ver20/XMLSchema` (version 2.0, real G2 cameras, S11c);
- `http://www.isapi.org/ver20/XMLSchema` (docs, S6);
- `urn:psialliance-org` (version 1.0, NVR and older cameras, S11d, S6 listening sample).

Older/NVR payloads use `protocolType` instead of `protocol` (S1 §16.2.130, S11d). They may lack `ipAddress` and put `serialNumber`/`eventPush` in `<Extensions>` (S11d).

**JSON** (S1 §16.1.52 p. 421, verbatim):

```
{
  "ipAddress": "",        /*required, device IPv4 address , string, the maximum size is 32 bytes*/
  "ipv6Address": "",      /*optional*/
  "portNo": ,             /*optional, device port No., integer32*/
  "protocol": "",         /*optional, protocol type, "HTTP , HTTPS"*/
  "macAddress": "",       /*optional, e.g., 01:17:24:45:D9:F4*/
  "channelID": "",        /*optional, device channel No., integer32*/
  "dateTime": "",         /*optional, ... ISO8601, the maximum size is 32 bytes, e.g., 2009-11-14T15:27Z*/
  "activePostCount": "",  /*required, alarm/event frequency, integer32*/
  "eventType": "",        /*required, alarm/event type, "captureResult, faceCapture,...", max 128 bytes*/
  "eventState": "",       /*required, "active"-valid, "inactive"-invalid*/
  "eventDescription": "", /*required*/
  "deviceID":"",          /*string type, device ID*/
  "uuid":"",              /*event UUID ... xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx*/
  ...
}
```

The comments were inline in the source; layout compressed.

**`dateTime`** is ISO 8601 with the camera's configured UTC offset (`+08:00`, `+01:00`, `+03:00` in samples) or `Z`. For Tashkent cameras, expect `+05:00` only if the camera timezone is set correctly. Parse with the offset and convert to UTC. Some docs show minute precision (`2009-11-14T15:27Z`).

**Event type aliases** (S1 §16.2.95 pp. 553–556; encoded in S17 `alarmEventAliases.js`). Each pair is the legacy name and the newer name:
- VMD / motionDetection
- shelteralarm / tamperDetection
- fielddetection / fieldDetection
- linedetection / lineDetection
- faceCapture / faceSnap
- **alarmResult / faceContrast** (= face comparison)
- targetCapture / humanRecognition

Also defined: regionEntrance, regionExiting, PeopleCounting, framesPeopleCounting, whiteFaceContrast (stranger), HFPD/LFPD.

### 2a. Face capture and face comparison against the camera's own library

**Event types in alarm payloads**
- `faceCapture`: every captured face (S3, S4). S1 Appendix A.2: "Face Capture Alarm faceCapture", "Face Picture Comparison Result alarmResult", "Stranger Detection Alarm whiteFaceContrast".
- `alarmResult`: library match (S4, S5).

**Event types in trigger/config lists.** These are names in `/ISAPI/Event/triggers` and `XML_EventTrigger`, not necessarily alarm `eventType` values: `faceSnap`, `faceContrast`, `whiteListFaceContrast`, `faceContrastSuccess`, `faceContrastFailure` (S20 trigger list on DS-7608NXI; S1 §16.2.132). Accept both naming families.

**Face comparison JSON (`alarmResult`)**, DeepinMind NVR, alertStream (S4 pp. 19–21). Keys and values are verbatim, PDF-extracted. Small objects (`faceRect`, `face_rect`, `extendData` items) were collapsed onto one line, and URLs split across PDF lines were re-joined. The `ipAddress` value "10639103" is garbled in the source PDF.

```json
{
    "ipAddress": "10639103",
    "portNo": 80,
    "protocol": "HTTP",
    "channelID": 2,
    "dateTime": "2017-10-20T11:12:16+08:00",
    "activePostCount": 65,
    "eventType": "alarmResult",
    "eventState": "active",
    "eventDescription": "alarmResult",
    "alarmResult": [{
        "targetAttrs": {
            "deviceChannel": 2,
            "deviceName": "Network Video Recorder",
            "faceTime": "2017-10-20T11:12:16+08:00",
            "face_picurl": "http://10639103:80/picture/Streaming/tracks/203/?name=ch0002_00000000120012657254400452524&size=452524"
        },
        "faces": [{
            "faceRect": { "height": 0.165000, "width": 0.093000, "x": 0.400000, "y": 0.577000 },
            "age": { "ageGroup": "young" },
            "gender": { "value": "male" },
            "glass": { "value": "yes" },
            "identify": [{
                "maxsimilarity": 0.970000,
                "candidate": [{
                    "blacklist_id": "tg",
                    "human_data": [{
                        "bkg_picurl": "http://10639103:80/FDLib?FDID=529FB9EAC2A04041A603E18F300CD3A5&pId=F4F665D6A18E41308CE9934DCDDD766F&size=22332",
                        "face_rect": { "height": 0.165000, "width": 0.093000, "x": 0.400000, "y": 0.577000 },
                        "similarity": 0.970000
                    }],
                    "reserve_field": {
                        "name": "111",
                        "gender": "male",
                        "bornTime": "2000-01-04",
                        "city": "530800",
                        "certificateType": "officerID",
                        "certificateNumber": "333333333333333333",
                        "phoneNumber": "88888888888888888888"
                    },
                    "similarity": 0.970000,
                    "listType": "blackList",
                    "extendData": [{
                        "extendID": 1, "enable": true, "name": "111", "value": "sdfasaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    }, {
                        "extendID": 2, "enable": true, "name": "222", "value": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    }, {
                        "extendID": 3, "enable": true, "name": "333", "value": "12345678901234567890123456789012$"
                    }, {
                        "extendID": 4, "enable": true, "name": "444", "value": "fff"
                    }]
                }]
            }],
            "URL": "http://10639103:80/picture/Streaming/tracks/203/?name=ch0002_00000000120012651315200058760&size=58760"
        }]
    }],
    "URLCertificationType": "digest"
}
```

**Where each item appears in this payload**

| Item | Location | Notes |
|---|---|---|
| Name | `alarmResult[].faces[].identify[].candidate[].reserve_field.name` | |
| Certificate/ID number | `...candidate[].reserve_field.certificateNumber` | Type in `certificateType` |
| Similarity | `candidate[].similarity` and `identify[].maxsimilarity` | Float 0–1. SDK `fSimilarity` range [0.001, 1] (S4, S10h) |
| FDID and picture ID | Only inside the `bkg_picurl` query string (`FDID=…&pId=…`) | No standalone `FDID`/`FPID` field in this sample |
| Library type | `candidate[].listType` (`blackList`) | `blacklist_id` is also present; its meaning is UNVERIFIED |
| Custom tags | `candidate[].extendData[]` (`extendID`, `enable`, `name`, `value`) | `PersonInfoExtendList` from enrollment, passed through |
| Picture URLs | Need digest auth: `"URLCertificationType": "digest"` | |

**SDK equivalents** (S10h–S10j, open.hikvision.com). `NET_VCA_FACESNAP_MATCH_ALARM` → `struBlackListInfo` (`NET_VCA_BLACKLIST_INFO_ALARM`) carries:
- `pFDID` ("人脸库ID": face library ID) and `pPID` ("人脸库图片ID": face picture ID);
- `wThresholdValue`;
- `struAttribute` (`NET_VCA_HUMAN_ATTRIBUTE`): `byName[NAME_LEN]`, `byCertificateType`, `byCertificateNumber[NAME_LEN]`, `pPersonInfoExtend`.

About `pPersonInfoExtend`, Hikvision's description (translated) says the device does not process this data and passes it through unchanged in the comparison upload. FDID/PID therefore exist in the device's data model. **UNVERIFIED:** whether the ISAPI JSON on a DeepinView *camera* exposes them as separate fields.

**Cloud/"FaceRawData" variant** of `identify[].candidate[]` (S10g `JSON_FACESNAP`, Chinese doc). Fields:
- `relationId`, `maxsimilarity`;
- `candidate[]`: `alarmId`, `blacklist_id`, `human_data[]` (`face_id`, `face_picurl`, `similarity`), `human_id` ("黑名单人员ID": blocklist person ID), `reserve_field` (string, ≤256 bytes, "预留字段": reserved field), `similarity`.

Treat this as a possible alternate shape. Do not assume `reserve_field` is always an object.

**Face capture JSON (`faceCapture`)**, thermal camera, HTTP listening, multipart part `faceCapture` (S3 pp. 12–14). Verbatim, PDF-extracted, truncated at the picture part:

```
POST / HTTP/1.1
Content-Type: multipart/form-data; boundary=boundary
Host: 10.7.69.13
Connection: Keep-Alive
Content-Length: 165370

--boundary
Content-Disposition: form-data; name="faceCapture"
Content-Type: application/json; charset="UTF-8"
Content-Length: 1332

{
 "ipAddress": "10.21.98.205",
 "portNo": 8080,
 "protocol": "HTTP",
 "macAddress": "a4:14:37:83:b8:1e",
 "channelID": 1,
 "dateTime": "2020-05-08T14:54:00+08:00",
 "activePostCount": 1,
 "eventType": "faceCapture",
 "eventState": "active",
 "eventDescription": "faceCapture",
 "channelName": "Camera 01",
 "faceCapture": [{
   "targetAttrs": {
    "deviceChannel": 1,
    "deviceName": "THERMAL CAMERA",
    "faceTime": "2020-05-08T14:53:57+08:00",
    "contentID": "backgroundImage",
    "contentID": "thermalPicture"
   },
   "faces": [{
     "faceId": 5288,
     "faceRect": { "height": 36.111, "width": 16.667, "x": 550.521, "y": 619.444 },
     "mask": { "value": "yes" },
     "contentID": "faceImage",
     "stayDuration": 0,
     "faceScore": 35,
     "captureEndMark": "false",
     "FacePictureRect": { "height": 55.263, "width": 24.554, "x": 546.131, "y": 613.158 },
     "swingAngle": 0,
     "tiltAngle": 0,
     "pupilDistance": 20,
     "livenessDetectionStatus": "notLiveFace",
     "faceSnapThermometryEnabled": "true",
     "currTemperature": 35.9,
     "isAbnomalTemperature": "false",
     "thermometryUnit": "celsius",
     "alarmTemperature": 37.0
    }],
   "uid": "2020050814540000011a41d7b1f7ee80b15b3b8a8594d1a9d2680884554ea0d4"
  }]
}
--boundary
Content-Disposition: form-data; name="facePicture"; filename="facePicture.jpg";
Content-Type: image/jpeg
Content-Length: 63115
```

A DeepinMind NVR `faceCapture` over alertStream uses the key `captureLibResult[]` instead of `faceCapture[]`, with `targetAttrs.bkgUrl` and `faces[].URL` (S4 pp. 24–25). The array key differs by device; accept either.

**Which field holds our own code ("S-12", "P-1001")**, by enrollment field:

| Field | Comes back in the match event? | Notes |
|---|---|---|
| `certificateNumber` | Yes: `reserve_field.certificateNumber` (S4) | xs:string; SDK buffer `NAME_LEN` = 32 bytes. The camera web UI shows an **"ID No."** column (S18 screenshot). **Best candidate.** UNVERIFIED: whether the UI or firmware rejects non-digit characters such as `S-12`; the only samples are digits. Test on the device. |
| `name` | Yes: `reserve_field.name` | Always available in the web UI. Fallback: enroll as e.g. `S-12` or `S-12 Ali`. |
| `PersonInfoExtendList` (custom tags) | Yes: `extendData[]` (S4); SDK says it is passed through (S10j) | S18: the iDS-7 web UI "don't support custom tags except name and gender … You can add custom tags via web or iVMS" (contradictory wording). |
| `customHumanID` (XML_FaceAppendData) | **UNVERIFIED** | Exists in the enrollment schema (S10d). Not seen in any event sample. |
| `FPID` | No sample shows it | JSON enrollment allows the client to set it on MinMoe terminals (S13: request FPID "4", response FPID "4"). On cameras FPID/PID appears to be device-generated (32-hex `pId` in the URL above). UNVERIFIED for DeepinView. |

### 2b. People counting (`PeopleCounting`)

**Real-time mode**, iDS-2CD7xxx (H7 platform, firmware 5.5.804), HTTP listening (S6 pp. 18–19). Verbatim, the `/* */` lines are the doc's annotations:

```
POST / HTTP/1.1
Content-Type: application/xml; charset="UTF-8"
Connection: Close
Host: 10.7.65.103:8089

<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="1.0" xmlns="urn:psialliance-org">
<ipAddress>10.18.98.66</ipAddress>
<protocolType>HTTP</protocolType>
<macAddress>98:df:82:30:1a:a0</macAddress>
<channelID>1</channelID>
<dateTime>2021-09-07T16:52:33+08:00</dateTime>
<activePostCount>1</activePostCount>
<eventType>PeopleCounting</eventType>
<eventState>active</eventState>
<eventDescription>peopleCounting alarm</eventDescription>
<channelName>Camera 01</channelName>
<peopleCounting>
<statisticalMethods>realTime</statisticalMethods>
/*statistic type realTime or timeRange */
<RealTime>
<time>2021-09-07T16:52:33+08:00</time>
</RealTime>
<enter>22</enter>
<exit>9</exit>
/* exit and enter number of person */
<vehicleEnter>176</vehicleEnter>
<vehicleExit>159</vehicleExit>
<bicycleEnter>5</bicycleEnter>
<bicycleExit>3</bicycleExit>
<pass>0</pass>
<duplicatePeople>0</duplicatePeople>
<regionsID>1</regionsID>
</peopleCounting>
</EventNotificationAlert>
```

**Statistical mode** ("Data Statistics Cycle"), same document (S6 p. 21). Verbatim; the trailing `FaceExpressionList` is cut here, and the doc says "below data is useless, please leave it":

```xml
<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<ipAddress>10.18.98.66</ipAddress>
<macAddress>98:df:82:30:1a:a0</macAddress>
<channelID>1</channelID>
<dateTime>2021-09-07T16:15:00+08:00</dateTime>
<eventType>PeopleCounting</eventType>
<eventState>active</eventState>
<eventDescription>peopleCounting alarm</eventDescription>
<peopleCounting>
<statisticalMethods>timeRange</statisticalMethods>
<TimeRange>
<startTime>2021-09-07T16:09:51+08:00</startTime>
<endTime>2021-09-07T16:15:00+08:00</endTime>
</TimeRange>
<enter>5</enter>
<exit>2</exit>
<pass>0</pass>
<duplicatePeople>0</duplicatePeople>
<vehicleEnter>38</vehicleEnter>
<vehicleExit>24</vehicleExit>
<bicycleEnter>1</bicycleEnter>
<bicycleExit>2</bicycleExit>
</peopleCounting>
<FaceExpressionList>
<FaceExpression>
<value>surprised</value>
<count>0</count>
...
```

**Another real-time capture** with `childCounting` (S16 go-hikvision test fixture, verbatim):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="1.0" xmlns="urn:psialliance-org">
<ipAddress>192.168.1.64</ipAddress>
<protocolType>HTTP</protocolType>
<macAddress>84:9a:40:ec:f1:6d</macAddress>
<channelID>1</channelID>
<dateTime>2020-07-09T12:07:07+08:00</dateTime>
<activePostCount>1</activePostCount>
<eventType>PeopleCounting</eventType>
<eventState>active</eventState>
<eventDescription>peopleCounting alarm</eventDescription>
<channelName>Camera 01</channelName>
<peopleCounting>
<statisticalMethods>realTime</statisticalMethods>
<RealTime>
<time>2020-07-09T12:07:07+08:00</time>
</RealTime>
<enter>70</enter>
<exit>75</exit>
<regionsID>1</regionsID>
</peopleCounting>
<childCounting>
<enter>0</enter>
<exit>0</exit>
</childCounting>
</EventNotificationAlert>
```

**Semantics**
- `realTime` counts appear to be **cumulative since the last reset**. The camera UI has a "Daily Reset Time" and a "Manual Reset" (S18 screenshot). This is inferred, not stated explicitly in any source (**UNVERIFIED**). Compute deltas, or prefer `timeRange` events, which carry per-window counts.
- `pass` = passing-by count; `duplicatePeople` = re-entries. Meanings inferred from names (**UNVERIFIED**).
- History: `POST /ISAPI/System/Video/inputs/channels/<ID>/counting/search` (S7 p. 6).
- **JSON variant: UNVERIFIED.** A use-ip.co.uk forum post (DS-2CD6825G0, 403 when fetched) reportedly shows JSON with `statisticalMethods: realTime`, `enter`/`exit` as strings, and a `childCounting` block. This comes only from a search summary.

### 2c. Intrusion, line crossing, region entrance/exit, tamper

**Intrusion with human target**, real camera, HTTP listening (S11c `fielddetection_human.xml`). Verbatim; IPs anonymised by the project:

```xml
<EventNotificationAlert version="2.0"
  xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <ipAddress>1.0.0.255</ipAddress>
  <ipv6Address>::ffff:192.168.2.5</ipv6Address>
  <portNo>80</portNo>
  <protocol>HTTP</protocol>
  <macAddress>ac:b9:2f:49:44:75</macAddress>
  <channelID>1</channelID>
  <dateTime>2022-01-31T13:53:05+01:00</dateTime>
  <activePostCount>1</activePostCount>
  <eventType>fielddetection</eventType>
  <eventState>active</eventState>
  <eventDescription>fielddetection alarm</eventDescription>
  <DetectionRegionList>
    <DetectionRegionEntry>
      <regionID>3</regionID>
      <sensitivityLevel>50</sensitivityLevel>
      <RegionCoordinatesList>
        <RegionCoordinates>
          <positionX>572</positionX>
          <positionY>100</positionY>
        </RegionCoordinates>
        <RegionCoordinates>
          <positionX>572</positionX>
          <positionY>995</positionY>
        </RegionCoordinates>
        <RegionCoordinates>
          <positionX>999</positionX>
          <positionY>998</positionY>
        </RegionCoordinates>
        <RegionCoordinates>
          <positionX>992</positionX>
          <positionY>210</positionY>
        </RegionCoordinates>
      </RegionCoordinatesList>
      <detectionTarget>human</detectionTarget>
      <TargetRect>
        <X>0.6</X>
        <Y>0.215278</Y>
        <width>0.135937</width>
        <height>0.505556</height>
      </TargetRect>
    </DetectionRegionEntry>
  </DetectionRegionList>
  <channelName>COUR NORD</channelName>
  <detectionPictureTransType>binary</detectionPictureTransType>
  <detectionPicturesNumber>1</detectionPicturesNumber>
  <isDataRetransmission>false</isDataRetransmission>
</EventNotificationAlert>
```

- `fielddetection_vehicle.xml` (S11c) is identical in shape with `<detectionTarget>vehicle</detectionTarget>`.
- **Target type field.** The field is `detectionTarget` (values `human`, `vehicle`), inside `DetectionRegionList/DetectionRegionEntry` (S11c; S8 "detectionTarget Detection target.Eg.human,vehicle"). A field literally named `targetType` was **not found** in event payloads (UNVERIFIED).

**NVR form** (S11d `nvr_2_fielddetection.xml`, verbatim). No ip/mac; serial is in Extensions; channel 34 = IP channel 2. hikvision_next maps channelID > 32 → IP camera.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="1.0"
  xmlns="urn:psialliance-org">
  <channelID>34</channelID>
  <dateTime>2023-01-13T19:16:39+01:00</dateTime>
  <activePostCount>174</activePostCount>
  <eventType>fielddetection</eventType>
  <eventState>active</eventState>
  <Extensions>
    <serialNumber xmlns="urn:selfextension:psiaext-ver10-xsd">DS-7608NXI-I0/0P/S0000000000CCRRJ00000000WCVU
    </serialNumber>
    <eventPush xmlns="urn:selfextension:psiaext-ver10-xsd">fielddetection&amp;&amp;DS-7608NXI-I0/0P/S0000000000CCRRJ00000000WCVU,2023-01-13T19:16:39+01:00,34,1.0</eventPush>
  </Extensions>
</EventNotificationAlert>
```

**"duration" wrapper.** One camera reports a `fielddetection` *end* or *duration* as `eventType=duration` with `<DurationList><Duration><relationEvent>fielddetection</relationEvent></Duration></DurationList>` (S11c `ipc_1_fielddetection.xml`).

**Fields per event**, from S8 (perimeter NVR doc) "Main field in the returned data" tables. No full XML samples were published for these in S8.

| Event | Fields |
|---|---|
| `linedetection` | dynChannelID, dateTime, eventType "linedetection", eventDescription "linedetection alarm", detectionTarget (human, vehicle), detectionPictureTransType (e.g. url), detectionPicturesNumber, bkgUrl, URLCertificationType (digest) |
| `regionEntrance` / `regionExiting` | Same as linedetection, plus `regionID` |
| Tamper | eventType `shelteralarm` (alias `tamperDetection`; S1 §16.2.95, S7 p. 14 "'shelteralarm' means 'Tamper'") |

**UNVERIFIED:** full verbatim `linedetection`, `regionEntrance`, `regionExiting`, `shelteralarm` payloads from a DeepinView camera, and the JSON shapes of these events when `parameterFormatType=JSON`.

**Other envelope fields**
- `eventState`: `active` for alarms. Durative alarms repeat with an increasing `activePostCount` "until the status is set to inactive" (S1 §16.2.128). `inactive` + `videoloss` = heartbeat.
- `activePostCount`: can be large (4268 in the PIR fixture, S11d).

---

## 3. Face library enrollment via ISAPI and the web UI

**Library CRUD (XML)** (S10e NET_DVR_STDXMLConfig FDLib table; S4 §12.3):

| Operation | Request | Response |
|---|---|---|
| Create | `POST /ISAPI/Intelligent/FDLib` with `CreateFDLibList` | `FDLibInfoList` |
| List | `GET /ISAPI/Intelligent/FDLib` | `FDLibBaseCfgList` |
| Batch modify | `PUT /ISAPI/Intelligent/FDLib` with `FDLibBaseCfgList` | |
| Get / modify / delete one | `GET/PUT/DELETE /ISAPI/Intelligent/FDLib/<FDID>` | `<FDID>` may be the device FDID or our `customFaceLibID` |

Face pictures:
- Add (S4 §12.3.2): `POST /ISAPI/Intelligent/pictureUpload`. S5 writes `/ISAPI/Intelligent/FDLib/pictureUpload`; S19-pykvision uses `/ISAPI/Intelligent/FDLib/pictureUpload?type=concurrent`. The exact path is UNVERIFIED per firmware.
- Delete / modify / get one picture: `DELETE|PUT|GET /ISAPI/Intelligent/FDLib/<FDID>/picture/<PID>`.
- Search: `POST /ISAPI/Intelligent/FDLib/FCSearch`.

**Create library** (S10a `XML_CreateFDLibList`, verbatim; Chinese comments translated in brackets):

```xml
<CreateFDLibList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <CreateFDLib>
    <id><!--req, xs:integer, [list item index, from 1]--></id>
    <name><!--opt, xs:string, [library name]--></name>
    <thresholdValue><!--opt, xs:integer, [threshold, range 0-100]--></thresholdValue>
    <customInfo><!--opt, xs:string, [library extra info]--></customInfo>
    <customFaceLibID><!--opt, xs:string, [custom library ID issued by the upper layer, kept unique by it; the device maps it to its FDID so later calls may use it instead of FDID]--></customFaceLibID>
  </CreateFDLib>
</CreateFDLibList>
```

The response `FDLibInfoList/FDLibInfo` has `id`, `name`, `FDID` (S10c).

**Per-face metadata, `XML_FaceAppendData`** (S10d, verbatim; comments translated in brackets; the source repeats `customHumanID` twice):

```xml
<FaceAppendData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <bornTime><!--opt, xs:ISO8601 time, [birth date], e.g. 2014-12-12T00:00:00Z--></bornTime>
  <name><!--opt, xs:string, [name]--></name>
  <sex><!--opt, xs:string, "male,female"--></sex>
  <province><!--opt, xs:string--></province>
  <city><!--opt, xs:string--></city>
  <certificateType><!--opt, xs:string, "officerID,ID,passportID,other"--></certificateType>
  <certificateNumber><!--dep, xs:string, [certificate number]--></certificateNumber>
  <PersonInfoExtendList size="">
    <PersonInfoExtend>
      <id><!--req, xs:integer, from 1--></id>
      <enable><!--req, xs:boolean--></enable>
      <name><!--opt, xs:string, [extension tag name]--></name>
      <value><!--opt, xs:string, [extension tag value]--></value>
    </PersonInfoExtend>
  </PersonInfoExtendList>
  <phoneNumber><!--opt, xs:string--></phoneNumber>
  <customHumanID><!--opt, xs:string, [custom person ID]--></customHumanID>
  <RegionCoordinatesList>...</RegionCoordinatesList>
</FaceAppendData>
```

This is the metadata the camera stores per face. Its fields map one-to-one to `reserve_field` and `extendData` in the `alarmResult` event (§2a).

**pictureUpload multipart wrapper `PictureUploadData`**: not found in a primary source. A third-party library (S19-pykvision) builds `PictureUploadData{FDID, FaceAppendData{name,bornTime,sex,certificateType,certificateNumber,PersonInfoExtendList}}`. Search snippets of the Scribd copy of the face-terminal ISAPI guide say the XML goes in a multipart part named `PictureUploadData` (`text/xml`), with the image in a second part. **UNVERIFIED.**

**JSON `FaceDataRecord`** (documented for access terminals, also listed for the face recognition server in S5)

- `POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json` "Import Face Library … FPID" (S5 p. 8).
- tpp wiki title in search results: "add a face record to a library identified by FDID by sending a picture URL or binary picture plus person info; the response returns the FPID".
- Real request/response on a MinMoe terminal (S13 vcr cassette, verbatim):

```
POST http://192.168.0.251/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json
{"faceLibType": "blackFD", "FDID": "1", "FPID": "4", "name": "tessst",
 "gender": "male", "bornTime": "19940226T000000+0500", "city": "Tashkent", "faceURL":
 "https://i.ibb.co/P9rJSTQ/murod.jpg"}

-> 200 application/json
{
	"requestURL":	"/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json",
	"statusCode":	1,
	"statusString":	"OK",
	"subStatusCode":	"ok",
	"FPID":	"4"
}
```

- Real library list (S13 `fplib-list.yml`):

  `GET /ISAPI/Intelligent/FDLib?format=json` → `{"requestURL":"/ISAPI/Intelligent/FDLib?format=json","statusCode":1,"statusString":"OK","subStatusCode":"ok","FDLib":[{"FDID":"2","faceLibType":"infraredFD","name":""}]}`

- Create-library JSON body sent by S13: `{"faceLibType": "blackFD", "name": "testfplib2", "customInfo": "testcustominfo"}`. On that terminal it failed with `subStatusCode "faceLibraryNumError"` (library limit reached).
- **Binary variant** (third-party, S19-Shaykhnazar `FaceService.php`): multipart with part `FaceDataRecord` = JSON `{faceLibType, FDID, FPID, …}` and part `img` (`image/jpeg`, filename `<FPID>.jpg`).
- `faceLibType` values seen: `blackFD` (list library), `staticFD`, `infraredFD`. From S13 and the Scribd search snippet; the meaning of `staticFD` is UNVERIFIED.

**Requested fields: status**

| Field | Status |
|---|---|
| `faceLibType`, `FDID`, `FPID`, `name`, `bornTime`, `city` (JSON) | Confirmed (S13) |
| `gender` (JSON) vs `sex` (XML) | Both confirmed in their respective formats |
| `certificateType` / `certificateNumber` | Confirmed in XML (S10d) and in the event (S4). In the FaceDataRecord JSON: **UNVERIFIED** (only a Scribd snippet mentions `certificateNumber` max 32 bytes) |
| `customHumanID` | Confirmed in XML (S10d). JSON: **UNVERIFIED** |

**Web UI (no server involvement)**
- Hikvision's own 2019 guidance for small-scale face recognition: "Regarding to Import Face Library, suggests customer to use website of camera to realize this feature in phase one" (S5 p. 4).
- iDS-7 series camera web UI (S18 screenshot, firmware with "Face Counting" VCA): *Configuration → Face Picture Library*. It has library list (+), buttons "Import / Add / Modify / Delete / Batch Modeling / Modeling / Import Model", search fields "Name, Gender, Modeling Status, ID Type, ID No., Date of Birth", and table columns **Name, Gender, Date of Birth, ID Type, ID No., Modeling Status**.
- Photo requirements (S18): JPG/JPEG, 20 KB–300 KB, pupil distance 40–300 px (60 recommended), one face per picture.
- **UNVERIFIED:** the fields of the "Add" dialog (very likely the same as the columns), and whether "ID No." accepts letters and hyphens. A clinic admin can therefore type the person's name and our code (ID No. or Name) in the camera UI. Our server never handles the photo. The code comes back in `reserve_field.certificateNumber` / `.name` of `alarmResult`.
- **Comparison configuration** (S10f `XML_FaceContrast`): per channel `enable`, `faceContrastType` (`faceContrast` | `whitelistFaceContrast` = stranger mode), `thresholdValue` 0–100, `FDLibList/FDLib/FDID` (libraries linked to the channel), `contrastFailureAlarmUpload` (also upload non-matches).
- **Capacity:** iDS-2CD7A46G0-IZHS spec lists up to 10 libraries × 30,000 faces, 150,000 total (Hikvision product page, from search result https://www.hikvision.com/en/products/IP-Products/Network-Cameras/DeepinView-Series/ids-2cd7a46g0-izhs-y--r-/). S18 says iDS7 face-counting firmware supports 3 libraries / 90,000.

---

## 4. Authentication and security

- **Digest auth** (S1 §3.1 pp. 32–33): "the digest of the session must be authenticated … based on HTTP Authentication: Basic and Digest Access Authentication … RFC 2617".
  - Supported: `qop` undefined, `auth`, `auth-int`.
  - Algorithms: MD5 or MD5-sess.
  - On failure the device returns `XML_ResponseStatus_AuthenticationFailed` with remaining attempts; at 0 the user is locked.
  - Real challenges: `WWW-Authenticate: Digest qop="auth", realm="IP Camera(C2183)", nonce="…", stale="FALSE"` (S1); `Digest qop="auth", realm="DS-317D433B", nonce="…", stale="false", opaque="", domain="::"` (S13, terminal).
  - Basic auth is usually disabled by default. The web UI has "WEB/RTSP Authentication: digest | digest/basic" (ipcamtalk threads in search results; UNVERIFIED primary).
  - Clock drift is reportedly relevant for digest (S19-uchkunr README claim, secondary, UNVERIFIED).
- **Event picture URLs** require digest too: `"URLCertificationType": "digest"` (S4, S8).
- **User permissions** (S1 §3.2): Administrator ("admin", all resources), Operator, Viewer.
  - Minimal user recommended by hikvision_next (S11 README): "Remote: Parameters Settings", "Remote: Log Search / Interrogate Working Status", "Remote: Live View", "Remote: Notify Surveillance Center / Trigger Alarm Output". The ISAPI user must be an Operator with these.
  - FDLib enrollment over ISAPI likely needs "Remote: Parameters Settings" (**UNVERIFIED**).
  - Enable ISAPI under Network → Advanced → Integration Protocol (S11 README "enabled ISAPI access"; S2 screenshot shows the "Integration Protocol" tab).
- **HTTPS on the camera**: *Configuration → Network → Advanced Settings → HTTPS → "Create Self-signed Certificate"*, or install a CA-signed certificate (Hikvision 2015 tech bulletin https://us-legacy.hikvision.com/sites/default/files/tb/tb_nvr_secure_socket.pdf, from search summary; not opened). Clients calling ISAPI over HTTPS must pin the camera's certificate or accept it as self-signed.
- **Sensitive-field encryption**: `?security=1|2` (AES128/256-CBC) for passwords inside ISAPI bodies such as httpHosts `<password>` (S1 §3.3, §15.3.5).

---

## 5. DeepinView camera vs DeepinMind NVR vs MinMoe terminal

| Aspect | DeepinView camera | DeepinMind NVR | MinMoe face terminal (DS-K1T…) |
|---|---|---|---|
| Envelope | `EventNotificationAlert` with ip, mac, channelID 1 (S11c, S6) | Often no ip/mac; serial and `eventPush` in `<Extensions>`; IP channels numbered from 33 (S11d); `dynChannelID` in perimeter docs (S8) | JSON `EventNotificationAlert` with `eventType: "AccessControllerEvent"` and an `AccessControllerEvent` object (S9, S14) |
| Face match | `alarmResult` (alias `faceContrast`) JSON. Shape for cameras: UNVERIFIED. Assume the same `faces[].identify[].candidate[].reserve_field` as the NVR. | `alarmResult` JSON with `identify/candidate/reserve_field/extendData` (S4) | No `alarmResult`. A recognised face is an access event: `majorEventType 5`, `subEventType 75` = face authentication passed (S15 README via search; S14). Person identity is `employeeNoString` + `name`. |
| Person ID | `certificateNumber` / `customHumanID` / extend tags in FDLib | Same | `employeeNo` / `employeeNoString` from `/ISAPI/AccessControl/UserInfo/SetUp?format=json` (S9). FDLib `FPID` is bound to the person (S13, S19) |
| HTTPS / hostname for httpHosts | Accepted by a single camera (S12) | Rejected on DS-7604NI-K1 (S12) | DS-K1T804AEF: unknown |

**Real MinMoe payload** (S14 `test_stream.py`, comment "Реальный payload с DS-K1T342MFWX" = "real payload from DS-K1T342MFWX"). Operation event:

```json
{"ipAddress":"192.168.7.104","portNo":443,"protocol":"HTTPS","dateTime":"2026-09-18T10:05:16+03:00","activePostCount":1,"eventType":"AccessControllerEvent","eventState":"active","eventDescription":"Access Controller Event","AccessControllerEvent":{"deviceName":"Access Controller","majorEventType":3,"subEventType":121,"remoteHostAddr":"192.168.7.110","serialNo":59091,"currentEvent":false,"frontSerialNo":59090,"label":"","purePwdVerifyEnable":true}}
```

Card authentication event (S14, labelled "from real payload"):

```json
{"dateTime":"2026-09-18T13:22:09+03:00","eventType":"AccessControllerEvent","AccessControllerEvent":{"majorEventType":5,"subEventType":1,"cardNo":"1947916138","cardType":1,"name":"ilya","cardReaderNo":1,"employeeNoString":"7","serialNo":59094,"userType":"normal","currentVerifyMode":"faceOrFpOrCardOrPw","currentEvent":true}}
```

Hikvision's own T&A deck (S9 p. 12, verbatim fragment):

`{... "dateTime": "2016-12-12T17:30:08+08:00","eventType": "AccessControllerEvent","eventDescription": "Access Controller Event","AccessControllerEvent":{ "cardNo": "","doorNo": ,"employeeNo": ,"employeeNoString": "","attendanceStatus":"","pictureURL": "",....}}`

On MinMoe the heartbeat on alertStream is JSON `{"eventType":"videoloss","eventState":"inactive",…}` (S14).

---

## 6. Recommended integration for our case

1. **Delivery: HTTP listening, received on the clinic LAN.**
   - Configure host id 1 per camera with:
     - `protocolType=HTTP`; HTTPS only if `/httpHosts/capabilities` lists it;
     - `addressingFormatType=ipaddress` (LAN IP of our receiver);
     - `url=/api/v1/camera-events/<random token>`, total ≤ 64 characters, token in the path not a query;
     - `parameterFormatType=JSON`, but expect XML anyway, because basic and VCA events are XML on many firmwares while face events are JSON;
     - `httpAuthenticationMethod=MD5digest` only if the capability lists it.
   - The admin can do this in the camera web UI (*Network → Advanced → HTTP Listening*) or we PUT it via ISAPI.
   - Tick "Notify Surveillance Center" on each event.
   - **Fallback:** a small LAN agent holding `GET /ISAPI/Event/notification/alertStream` (digest, reconnect after 30–40 s without a heartbeat). Use it if the receiver cannot be reached from the camera VLAN or listening proves unreliable.
2. **Receiver:**
   - Accept `application/xml`, `text/xml`, `application/json`, `text/json`, `multipart/form-data` and `multipart/mixed` (for an agent).
   - Pick the first XML or JSON part.
   - **Discard every `image/*` part without storing it.** Face crops are biometric data; the Uzbek law note in CLAUDE.md applies, and the Railway demo must not receive them.
   - Cap the body size (face events with two JPEGs are ~165 KB in S3; allow ≥1 MB).
   - Always answer 200 quickly. Validate the token, then the source IP + `macAddress` against a registered camera (tenant from the camera row, never from the payload).
3. **Parsing:**
   - XML: namespace-agnostic (match local names). Accept both `protocol` and `protocolType`.
   - JSON: tolerate duplicate keys, numbers as strings, and `faceCapture[]` vs `captureLibResult[]`.
   - Normalise event aliases (`alarmResult|faceContrast`, `faceCapture|faceSnap`, `fielddetection|fieldDetection`, `linedetection|lineDetection`, `shelteralarm|tamperDetection`, `PeopleCounting|peopleCounting`).
   - Ignore heartbeats (`videoloss`+`inactive`, `heartBeat`).
   - Map `detectionTarget` to human/vehicle.
4. **Identity:**
   - Enroll in the camera UI with **ID Type = other, ID No. = our code** (e.g. `S12` or `1001`). Test first whether `S-12` with a hyphen is accepted; if not, use digits or put the code in Name.
   - Read the code from `alarmResult[].faces[].identify[].candidate[].reserve_field.certificateNumber`, falling back to `.name`.
   - Store the code, similarity and time only. Apply our own similarity floor in addition to the camera threshold.
5. **Time and deduplication:**
   - Parse `dateTime` with its offset, convert to UTC, and keep the receipt time from `core/clock.ts`.
   - Deduplicate on (camera, channelID, eventType, dateTime, activePostCount, `uid`/`uuid` when present).
   - Treat `isDataRetransmission=true` as a possible replay.
   - Check the camera NTP and timezone (UTC+5) during onboarding.
6. **People counting:** use `statisticalMethods=timeRange` (Data Statistics Cycle) for reporting. If `realTime` is used, store the raw cumulative values and compute deltas, handling the daily reset (value drops).
7. **Test fixtures:** use the verbatim payloads above (with doc comments removed), plus edge cases: psialliance namespace, NVR `Extensions` form, `duration` wrapper, duplicate JSON keys, multipart with two JPEGs, boundary quoted or with a `--` prefix, missing `Content-Length`.

---

## 7. Not confirmed (UNVERIFIED)

1. The exact `alarmResult` (face comparison) JSON from a **DeepinView camera** on 5.5–5.7 firmware, and whether it contains standalone `FDID`/`FPID`/`PID`/`customHumanID`. Only an NVR sample (S4) and SDK structs (S10h–j) were found. Also unverified: the multipart part name for `alarmResult` in listening mode (likely `alarmResult`, by analogy with `faceCapture`).
2. Whether the camera web UI "ID No." accepts non-numeric characters (`S-12`), and its maximum length in the UI (SDK buffer is 32 bytes).
3. The fields of the web-UI "Add face" dialog on iDS-2CD7xxx 5.5–5.7. Only the list view (Name, Gender, DoB, ID Type, ID No.) was seen (S18).
4. HTTPS push support, certificate validation behaviour, and `MD5digest` listener auth on DeepinView 5.5–5.7. Read `/ISAPI/Event/notification/httpHosts/capabilities` on the real device.
5. Retry/back-off policy for failed listening POSTs, and the exact semantics of `httpBroken` and `isDataRetransmission`.
6. Whether query strings in `<url>` are preserved.
7. Full verbatim `linedetection`, `regionEntrance`, `regionExiting`, `shelteralarm` payloads from a DeepinView camera. Only field tables (S8) and fielddetection samples (S11c) were found. Also the JSON forms of these events.
8. A field literally called `targetType`. Only `detectionTarget` was found.
9. The exact pictureUpload request (`/ISAPI/Intelligent/pictureUpload` vs `/ISAPI/Intelligent/FDLib/pictureUpload`) and the `PictureUploadData` XML and multipart part names. Also whether `FaceDataRecord?format=json` with `certificateNumber`/`customHumanID` works on DeepinView cameras (confirmed only on MinMoe terminals).
10. PeopleCounting JSON shape, and whether `realTime` counts are cumulative (inferred from the UI's "Daily Reset Time").
11. Exact user-permission set needed for FDLib writes.
12. Whether listening mode sends any heartbeat to the listener. None seen in sources; assume no.

---

## Sources

**Hikvision primary documents**
- **S1** — Hikvision, *Intelligent Security API (General Application) Developer Guide* (© 2019). Mirrors, byte-identical (md5 f44a4e1b…): https://download.isecj.jp/catalog/misc/isapi.pdf and https://support.zabbix.com/secure/attachment/284957/isapi-2.pdf (also https://github.com/loozhengyuan/hikvision-sdk/blob/master/resources/isapi.pdf, same size).
- **S2** — Hikvision Europe, *How to get real-time alarm/event in HTTP listening mode*: https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/03-How%20to/How%20to%20get%20real-time%20event%20in%20listening%20mode.pdf (screenshots of web UI, Postman PUT, NetAssist capture). See also *How to get events by ISAPI listening mode*: https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/03-How%20to/How%20to%20get%20%20events%20by%20ISAPI%20listening%20mode.pdf
- **S3** — Hikvision Europe, *Temperature Screening Camera Integration Solution*: https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/02-Solutioins%20of%20Hikvision%20product%20integration/Temperature%20Screening%20Camera%20Integration%20Solution%20.pdf
- **S4** — Hikvision Europe, *Face Recognition NVR Integration Solution*: https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/02-Solutioins%20of%20Hikvision%20product%20integration/Face%20Recognition%20NVR%20Integration%20Solution.pdf
- **S5** — Hikvision, *Face Recognition Integrate Solution* (2019-03-22): http://www.hikvisioneurope.com/za/portal/portal/01-Product&%20solution%20promotion/02-Solution%20Promotion/03--Solution%20by%20industry(such%20as%20Mine,Bank,education,etc)/09-Product%20integration%20technology%20solution/01-Face%20Recognition%20Solution-190322.pdf
- **S6** — Hikvision Europe, *Multi-Target Counting Integration Solution* (iDS-2CD7XXX H7, fw 5.5.804): https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/02-Solutioins%20of%20Hikvision%20product%20integration/Multi-Target%20Counting%20Integration%20Solution.pdf
- **S7** — Hikvision, *People Counting Integration Solution* (2019-03-08): https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/02-Solutioins%20of%20Hikvision%20product%20integration/People%20Counting%20Integration%20Solution-20190308.pdf
- **S8** — Hikvision Europe, *Perimeter Protection NVR Integration Solution*: https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/02-Solutioins%20of%20Hikvision%20product%20integration/Perimeter%20Protection%20NVR%20Integration%20Solution.pdf
- **S9** — Hikvision, *T&A integrate solution* (HIK-League 2022): http://www.hikvisioneurope.com/za/portal/portal/02-Technical%20Materials/04-Training%20materials/03-HIK-League%202022/Technical(Thursday)/20220526%20Hikvision%20T&A%20integrate%20solution/20220526%20Hikvision%20T&A%20integrate%20solution.pdf
- **S10** — Hikvision Open Platform, Device Network SDK / ISAPI definitions (Chinese, GBK):
  - a. https://open.hikvision.com/hardware/XMLs/XML_HttpHostNotification.html
  - b. https://open.hikvision.com/hardware/XMLs/XML_EventNotificationAlert.html
  - c. https://open.hikvision.com/hardware/XMLs/XML_FDLibInfoList.html, https://open.hikvision.com/hardware/XMLs/XML_CreateFDLibList.html, https://open.hikvision.com/hardware/XMLs/XML_FDLibBaseCfg.html
  - d. https://open.hikvision.com/hardware/XMLs/XML_FaceAppendData.html
  - e. https://open.hikvision.com/hardware/definitions/NET_DVR_STDXMLConfig_XFA_FDLib_gl.html
  - f. https://open.hikvision.com/hardware/XMLs/XML_FaceContrast.html
  - g. https://open.hikvision.com/hardware/JSONs/JSON_FACESNAP.html (and https://open.hikvision.com/hardware/JSONs/EVENT_JSON_HFPDalertStream.html)
  - h. https://open.hikvision.com/hardware/structures/NET_VCA_FACESNAP_MATCH_ALARM.html
  - i. https://open.hikvision.com/hardware/structures/NET_VCA_BLACKLIST_INFO_ALARM.html
  - j. https://open.hikvision.com/hardware/structures/NET_VCA_HUMAN_ATTRIBUTE.html

**Open-source projects (real-device fixtures and parsers)**
- **S11** — maciej-or/hikvision_next (Home Assistant integration):
  - a. https://raw.githubusercontent.com/maciej-or/hikvision_next/main/tests/fixtures/ISAPI/Event.notification.httpHosts/ipc_list.xml
  - b. https://raw.githubusercontent.com/maciej-or/hikvision_next/main/tests/fixtures/ISAPI/Event.notification.httpHosts/set_alarm_server_outside_network_payload.xml (and `nvr_single_item.xml`, `set_alarm_server_payload.xml`)
  - c. https://raw.githubusercontent.com/maciej-or/hikvision_next/main/tests/fixtures/ISAPI/EventNotificationAlert/fielddetection_human.xml (also `fielddetection_vehicle.xml`, `ipc_1_fielddetection.xml`, `cam1_DS-2CD2T46G2-ISU_io_notification.xml`)
  - d. https://raw.githubusercontent.com/maciej-or/hikvision_next/main/tests/fixtures/ISAPI/EventNotificationAlert/nvr_2_fielddetection.xml and `pir.xml`
  - e. https://github.com/maciej-or/hikvision_next/blob/main/custom_components/hikvision_next/notifications.py
  - README: https://github.com/maciej-or/hikvision_next
- **S12** — hikvision_next issue #179 (HTTPS / hostname support differs camera vs NVR): https://github.com/maciej-or/hikvision_next/issues/179
- **S13** — shadowwa1k3r/hikvision-isapi-wrapper VCR cassettes (real terminal responses): https://github.com/shadowwa1k3r/hikvision-isapi-wrapper/tree/master/tests/vcr_cassettes (`fp-data-add.yml`, `fplib-list.yml`, `fplib-add.yml`), code `hikvision_isapi_wrapper/fplib.py`.
- **S14** — vvpich/hikvision-acs `tests/test_stream.py`: https://github.com/vvpich/hikvision-acs/blob/main/tests/test_stream.py
- **S15** — Titosoft/hikvision-access-control `tests/test_parser.py`: https://github.com/Titosoft/hikvision-access-control/blob/main/tests/test_parser.py
- **S16** — dumacp/go-hikvision `peoplecounting/listenner_test.go`: https://github.com/dumacp/go-hikvision/blob/master/peoplecounting/listenner_test.go
- **S17** — Supergiovane/node-red-contrib-hikvision-ultimate `nodes/utils/alarmEventAliases.js`, `nodes/utils/alertStreamParser.js`, `nodes/Hikvision-config.js`: https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate

**Other**
- **S18** — Hikvision Europe, *Installation and Configuration Guide for iDS 7series Face Counting Camera* (web-UI screenshots of Face Picture Library): https://www.hikvisioneurope.com/eu//portal/portal/Technical%20Materials/24%20How%20To/CCTV/Installation%20and%20Configuration%20Guide%20for%20iDS%207series%20Face%20Counting%20Camera.pdf
- **S19** — Secondary, third-party libraries:
  - Shaykhnazar/hikvision-isapi https://github.com/Shaykhnazar/hikvision-isapi (`src/Services/FaceService.php`);
  - HandreyGama/pykvision https://github.com/HandreyGama/pykvision (`models/dataclasses.py`, `models/endpoints.py`);
  - uchkunr/hikvision-best-practices https://github.com/uchkunr/hikvision-best-practices.
- **S20** — home-assistant/core issue #178778 (face trigger IDs on a DS-7608NXI NVR): https://github.com/home-assistant/core/issues/178778
