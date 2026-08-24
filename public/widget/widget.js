(function () {
  "use strict";

  var parameters = new URLSearchParams(window.location.search);
  var widgetId = parameters.get("widgetId") || "standalone";
  var captchaType = "gravity";
  var requestedParentOrigin = parameters.get("parentOrigin");
  var parentOrigin = null;
  try {
    var parsedParent = new URL(requestedParentOrigin || window.location.origin);
    if (parsedParent.protocol === "https:" || parsedParent.protocol === "http:") {
      parentOrigin = parsedParent.origin;
    }
  } catch (_) {
    parentOrigin = null;
  }

  var form = document.getElementById("captcha-form");
  var input = document.getElementById("captcha-answer");
  var verifyButton = document.getElementById("verify-button");
  var newButton = document.getElementById("new-button");
  var audioButton = document.getElementById("audio-button");
  var audioStatus = document.getElementById("audio-status");
  var image = document.getElementById("verification-image");
  var placeholder = document.getElementById("stage-placeholder");
  var stage = document.getElementById("verification-stage");
  var message = document.getElementById("status-message");
  var pill = document.getElementById("status-pill");
  var title = document.getElementById("captcha-title");
  var currentVerificationId = null;
  var currentAudioUrl = null;
  var audioObjectUrl = null;
  var audioPlayer = null;
  var audioLoading = false;
  var expiryTimer = null;
  var cooldownTimer = null;
  var busy = false;
  var coolingDown = false;
  var completed = false;

  document.body.classList.toggle("theme-gravity", captchaType === "gravity");
  stage.classList.toggle("is-gravity", captchaType === "gravity");
  title.textContent = "NexaCAPTCHA Gravity";
  image.alt = "Distorted verification text";

  function send(type, payload) {
    if (!parentOrigin || window.parent === window) return;
    window.parent.postMessage(
      Object.assign({ namespace: "NexaCAPTCHA", widgetId: widgetId, type: type }, payload),
      parentOrigin
    );
  }

  function sendResult(result) {
    send("result", { result: result });
  }

  function setPill(label, icon, kind) {
    pill.className = "status-pill" + (kind ? " " + kind : "");
    pill.replaceChildren();
    if (icon) {
      var iconElement = document.createElement("i");
      iconElement.className = "fa-solid " + icon;
      iconElement.setAttribute("aria-hidden", "true");
      pill.append(iconElement);
    }
    pill.append(document.createTextNode(label));
  }

  function setMessage(text, kind) {
    message.textContent = text;
    message.className = kind || "";
  }

  function updateControls() {
    stage.setAttribute("aria-busy", String(busy));
    var inactive = busy || completed || !currentVerificationId;
    verifyButton.disabled = inactive || coolingDown;
    input.disabled = inactive;
    newButton.disabled = busy || coolingDown;
    audioButton.disabled = busy || completed || !currentVerificationId || !currentAudioUrl || audioLoading;
  }

  function setAudioButton(label, icon) {
    audioButton.replaceChildren();
    var iconElement = document.createElement("i");
    iconElement.className = "fa-solid " + icon;
    iconElement.setAttribute("aria-hidden", "true");
    audioButton.append(iconElement, document.createTextNode(label));
  }

  function resetAudio() {
    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.removeAttribute("src");
    }
    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    audioPlayer = null;
    audioObjectUrl = null;
    currentAudioUrl = null;
    audioLoading = false;
    audioStatus.textContent = "";
    setAudioButton("Audio", "fa-volume-high");
  }

  function clearTimers() {
    if (expiryTimer) window.clearTimeout(expiryTimer);
    if (cooldownTimer) window.clearInterval(cooldownTimer);
    expiryTimer = null;
    cooldownTimer = null;
  }

  function showLoadingPlaceholder(text) {
    image.classList.remove("is-visible");
    image.removeAttribute("src");
    placeholder.hidden = false;
    placeholder.replaceChildren();
    var icon = document.createElement("i");
    icon.className = "fa-solid fa-circle-notch fa-spin";
    icon.setAttribute("aria-hidden", "true");
    placeholder.append(icon, document.createTextNode(text));
  }

  function armExpiry(expiresAtOrDuration) {
    if (expiryTimer) window.clearTimeout(expiryTimer);
    var durationMs = typeof expiresAtOrDuration === "string"
      ? new Date(expiresAtOrDuration).getTime() - Date.now()
      : expiresAtOrDuration;
    expiryTimer = window.setTimeout(function () {
      currentVerificationId = null;
      completed = false;
      coolingDown = false;
      updateControls();
      setPill("Expired", "fa-clock", "is-error");
      setMessage("This verification expired after two minutes. Request a new one.", "is-error");
      sendResult({ success: false, verificationId: null, responseToken: null });
    }, Math.max(0, durationMs));
  }

  function startCooldown(seconds) {
    var remaining = Math.max(1, Math.ceil(seconds));
    coolingDown = true;
    updateControls();
    setPill("Wait", "fa-hourglass-half", "");

    function renderCooldown() {
      setMessage(
        "That was not correct. You can enter another answer in " + remaining + " seconds.",
        "is-error"
      );
    }

    renderCooldown();
    cooldownTimer = window.setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(cooldownTimer);
        cooldownTimer = null;
        coolingDown = false;
        setPill("Try again", "fa-keyboard", "");
        setMessage("Enter your next answer. One more incorrect answer ends this verification.", "");
        updateControls();
        input.focus();
        return;
      }
      renderCooldown();
    }, 1000);
  }

  function scheduleVerification() {
    clearTimers();
    image.onload = null;
    image.onerror = null;
    completed = false;
    coolingDown = false;
    currentVerificationId = null;
    resetAudio();
    input.value = "";
    busy = true;
    updateControls();
    sendResult({ success: false, verificationId: null, responseToken: null });

    showLoadingPlaceholder("Preparing verification…");
    setPill("Loading", "", "");
    setMessage("Loading a new verification…", "");
    void createVerification();
  }

  async function createVerification() {
    showLoadingPlaceholder("Preparing verification…");
    setPill("Loading", "", "");
    setMessage("Loading a new verification…", "");

    try {
      var response = await fetch("/api/verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captchaType: captchaType }),
        cache: "no-store"
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.errorCode || "verification-create-error");

      currentVerificationId = result.verificationId;
      currentAudioUrl = result.audioUrl || null;
      image.onload = function () {
        var playbackVerificationId = currentVerificationId;
        placeholder.hidden = true;
        image.classList.add("is-visible");
        busy = false;
        setPill("Playing", "fa-eye", "");
        setMessage("Read the distorted text, then enter all four characters.", "");
        updateControls();
        armExpiry(Math.max(1_000, (result.expiresInMs || 120_000) - 1_000));
        void fetch(
          "/api/verifications/" + encodeURIComponent(playbackVerificationId) + "/status",
          { cache: "no-store" }
        ).then(function (statusResponse) {
          if (!statusResponse.ok) throw new Error("status-error");
          return statusResponse.json();
        }).then(function (status) {
          if (currentVerificationId === playbackVerificationId && status.expiresAt) {
            armExpiry(status.expiresAt);
          }
        }).catch(function () {
          // The conservative local timer remains armed when status sync fails.
        });
        input.focus();
      };
      image.onerror = function () {
        currentVerificationId = null;
        busy = false;
        setPill("Error", "fa-circle-exclamation", "is-error");
        setMessage("The verification image could not be loaded. Try again.", "is-error");
        updateControls();
      };
      image.src = result.imageUrl;
    } catch (_) {
      currentVerificationId = null;
      busy = false;
      setPill("Offline", "fa-triangle-exclamation", "is-error");
      setMessage("Unable to reach NexaCAPTCHA. Try again.", "is-error");
      updateControls();
    }
  }


  async function playAudio() {
    if (busy || completed || !currentVerificationId || !currentAudioUrl || audioLoading) return;
    try {
      if (!audioPlayer) {
        audioLoading = true;
        setAudioButton("Loading", "fa-volume-high");
        updateControls();
        var response = await fetch(currentAudioUrl, { cache: "no-store" });
        if (!response.ok) throw new Error("audio-load-error");
        var blob = await response.blob();
        audioObjectUrl = URL.createObjectURL(blob);
        audioPlayer = new Audio(audioObjectUrl);
        audioPlayer.addEventListener("ended", function () {
          audioStatus.textContent = "Audio verification finished. Select Audio to replay it.";
          setAudioButton("Replay", "fa-rotate-right");
        });
        audioLoading = false;
      }
      audioPlayer.currentTime = 0;
      await audioPlayer.play();
      audioStatus.textContent = "Playing the audio verification.";
      setAudioButton("Playing", "fa-volume-high");
    } catch (_) {
      audioLoading = false;
      audioStatus.textContent = "The audio verification could not be played.";
      setAudioButton("Audio unavailable", "fa-volume-xmark");
    }
    updateControls();
  }

  async function submitAnswer(event) {
    event.preventDefault();
    if (busy || coolingDown || completed || !currentVerificationId) return;
    var answer = input.value.trim().toUpperCase();
    input.value = answer;
    if (answer.length !== 4) {
      setMessage("Enter all four characters before verifying.", "is-error");
      input.focus();
      return;
    }

    busy = true;
    updateControls();
    setPill("Checking", "", "");
    setMessage("Checking your answer…", "");
    try {
      var response = await fetch(
        "/api/verifications/" + encodeURIComponent(currentVerificationId) + "/answer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: answer }),
          cache: "no-store"
        }
      );
      var result = await response.json();
      if (!response.ok) throw new Error(result.errorCode || "verification-error");

      busy = false;
      if (result.success) {
        completed = true;
        clearTimers();
        setPill("Complete", "fa-circle-check", "is-complete");
        setMessage("Verification complete.", "is-success");
        updateControls();
        sendResult({
          success: true,
          verificationId: result.verificationId,
          responseToken: result.responseToken
        });
        return;
      }

      input.value = "";
      if (result.status === "verification_failed") {
        clearTimers();
        currentVerificationId = null;
        setPill("Failed", "fa-circle-exclamation", "is-error");
        setMessage("Two incorrect answers ended this verification.", "is-error");
        updateControls();
      } else {
        startCooldown(result.retryAfterSeconds || 20);
      }
    } catch (error) {
      busy = false;
      var code = String(error.message);
      if (code.includes("verification-expired")) {
        clearTimers();
        currentVerificationId = null;
        setPill("Expired", "fa-clock", "is-error");
        setMessage("This verification expired after two minutes. Request a new one.", "is-error");
        updateControls();
      } else if (code.includes("answer-cooldown")) {
        startCooldown(20);
      } else {
        setPill("Error", "fa-circle-exclamation", "is-error");
        setMessage("Verification could not be completed. Try again.", "is-error");
        updateControls();
      }
    }
  }

  input.addEventListener("input", function () {
    input.value = input.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  });
  form.addEventListener("submit", submitAnswer);
  newButton.addEventListener("click", scheduleVerification);
  audioButton.addEventListener("click", function () { void playAudio(); });
  window.addEventListener("message", function (event) {
    if (event.origin !== parentOrigin) return;
    var data = event.data;
    if (!data || data.namespace !== "NexaCAPTCHA" || data.widgetId !== widgetId) return;
    if (data.type === "reset") scheduleVerification();
  });
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      send("resize", { height: document.documentElement.scrollHeight + 12 });
    }).observe(document.body);
  }

  busy = false;
  updateControls();
  scheduleVerification();
})();
