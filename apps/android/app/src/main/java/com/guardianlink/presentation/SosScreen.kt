package com.guardianlink.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.guardianlink.R
import kotlin.math.ceil

/**
 * The SOS screen.
 *
 * Accessibility decisions worth reading, because they are the ones people usually get
 * wrong on a screen like this:
 *
 *   - The countdown is a **polite** live region, not assertive. TalkBack announces it
 *     without cutting off whatever the user is already listening to. Assertive here would
 *     interrupt every second, which makes the screen unusable with a screen reader.
 *   - The seconds are announced through `contentDescription` as a sentence, while the
 *     visible text stays terse. A screen reader user gets no benefit from compactness.
 *   - The SOS control is 96 dp, twice the 48 dp minimum, because it is pressed under
 *     stress and possibly one-handed.
 *   - State is never signalled by colour alone: the wording and the control both change.
 */
@Composable
fun SosScreen(
    viewModel: SosViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Surface(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
        ) {
            // Not dismissible, and above the control rather than below it. Somebody on
            // this screen should not have to scroll to find out nobody is monitoring it.
            Text(
                text = stringResource(R.string.demo_notice_short),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )

            when (val current = state) {
                is SosViewModel.UiState.Idle -> IdleControl(onStart = viewModel::startCountdown)

                is SosViewModel.UiState.CountingDown -> CountdownControl(
                    state = current,
                    onCancel = { viewModel.cancel() },
                )

                is SosViewModel.UiState.Activating -> Text(
                    text = "Raising the alert",
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )

                is SosViewModel.UiState.Active -> ActiveIncident(current)

                is SosViewModel.UiState.Failed -> Text(
                    text = current.message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error,
                    // Assertive: a failure is exactly the case where interrupting is right.
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                )
            }
        }
    }
}

@Composable
private fun IdleControl(onStart: () -> Unit) {
    Button(
        onClick = onStart,
        modifier = Modifier
            .size(96.dp)
            .semantics {
                contentDescription =
                    "Raise an alert. A ten second countdown starts, and you can cancel it."
            },
    ) {
        Text(stringResource(R.string.sos_button), style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun CountdownControl(
    state: SosViewModel.UiState.CountingDown,
    onCancel: () -> Unit,
) {
    val seconds = ceil(state.remainingMillis / 1000.0).toInt()

    Box(contentAlignment = Alignment.Center) {
        CircularProgressIndicator(
            progress = { state.progress },
            modifier = Modifier.size(160.dp),
        )

        Text(
            text = "$seconds",
            style = MaterialTheme.typography.displayLarge,
            modifier = Modifier.semantics {
                // Polite, so it does not interrupt every second and make the screen
                // unusable with TalkBack. The description is a sentence; the visible text
                // is a numeral.
                liveRegion = LiveRegionMode.Polite
                contentDescription = "$seconds seconds until your contacts are told"
            },
        )
    }

    OutlinedButton(
        onClick = onCancel,
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = "Cancel the alert before it is sent" },
    ) {
        Text(stringResource(R.string.sos_cancel))
    }
}

@Composable
private fun ActiveIncident(state: SosViewModel.UiState.Active) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "Alert raised",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )

        if (state.queued) {
            // Honest about the state. The user believes an alert was raised, and from
            // their point of view it was: the intent is recorded and will send. Saying
            // nothing would be worse, and saying "failed" would be wrong.
            Text(
                text = "No connection. Your alert is saved and will send as soon as there is signal.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Text(
                text = "Your trusted contacts are being told.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
