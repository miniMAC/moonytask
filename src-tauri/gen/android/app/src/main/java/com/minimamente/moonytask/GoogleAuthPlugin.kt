package com.minimamente.moonytask

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope

@InvokeArg
class GoogleAuthorizeArgs {
  var interactive: Boolean = false
}

@TauriPlugin
class GoogleAuthPlugin(private val activity: Activity) : Plugin(activity) {
  private val authorizationClient by lazy {
    Identity.getAuthorizationClient(activity)
  }

  @Command
  fun authorize(invoke: Invoke) {
    val args = try {
      invoke.parseArgs(GoogleAuthorizeArgs::class.java)
    } catch (error: Exception) {
      invoke.reject(error.message ?: "invalid_google_auth_request")
      return
    }

    val builder = AuthorizationRequest.builder()
      .setRequestedScopes(
        listOf(
          Scope("https://www.googleapis.com/auth/drive.appdata"),
          Scope("openid"),
          Scope("email"),
        ),
      )

    if (args.interactive) {
      builder.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT)
    }

    authorizationClient
      .authorize(builder.build())
      .addOnSuccessListener { result ->
        if (result.hasResolution()) {
          if (!args.interactive) {
            invoke.reject("google_reauthorization_required")
            return@addOnSuccessListener
          }
          val pendingIntent = result.pendingIntent
          if (pendingIntent == null) {
            invoke.reject("google_authorization_resolution_missing")
            return@addOnSuccessListener
          }
          val request = IntentSenderRequest.Builder(pendingIntent.intentSender).build()
          startIntentSenderForResult(invoke, request, "authorizationResult")
        } else {
          resolveAuthorization(invoke, result)
        }
      }
      .addOnFailureListener { error ->
        rejectAuthorization(invoke, error)
      }
  }

  @ActivityCallback
  fun authorizationResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode == Activity.RESULT_CANCELED) {
      invoke.reject("google_authorization_cancelled")
      return
    }
    if (result.resultCode != Activity.RESULT_OK || result.data == null) {
      invoke.reject("google_authorization_failed")
      return
    }

    try {
      resolveAuthorization(
        invoke,
        authorizationClient.getAuthorizationResultFromIntent(result.data!!),
      )
    } catch (error: Exception) {
      rejectAuthorization(invoke, error)
    }
  }

  private fun resolveAuthorization(invoke: Invoke, result: AuthorizationResult) {
    val accessToken = result.accessToken
    if (accessToken.isNullOrBlank()) {
      invoke.reject("google_access_token_missing")
      return
    }

    val response = JSObject()
    response.put("accessToken", accessToken)
    response.put("email", result.toGoogleSignInAccount()?.email)
    // I token di accesso Google hanno durata nominale di un'ora. Rust usa un
    // margine aggiuntivo di 60 secondi prima di chiederne uno nuovo.
    response.put("expiresInSecs", 3_600L)
    invoke.resolve(response)
  }

  private fun rejectAuthorization(invoke: Invoke, error: Exception) {
    val message = if (error is ApiException) {
      "google_authorization_failed:${error.statusCode}"
    } else {
      error.message ?: "google_authorization_failed"
    }
    invoke.reject(message)
  }
}
